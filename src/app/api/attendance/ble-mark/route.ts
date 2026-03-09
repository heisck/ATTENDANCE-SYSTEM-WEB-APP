import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncAttendanceSessionState } from "@/lib/attendance";
import { getQrSequence, verifyQrTokenForSequence } from "@/lib/qr";
import { calculateConfidence, isFlagged } from "@/lib/confidence";
import { logError, ApiErrorMessages } from "@/lib/api-error";
import {
  checkRateLimit,
  cacheGet,
  cacheSet,
  cacheGetOrCompute,
  cacheDel,
  CACHE_KEYS,
  CACHE_TTL,
} from "@/lib/cache";
import {
  DeviceTokenConflictError,
  getDeviceConsistencyScore,
  linkDevice,
} from "@/lib/device-linking";
import { getDeviceBleStats } from "@/lib/ble-verification";
import { getBleBroadcasterPresence, getSessionBleBroadcast } from "@/lib/lecturer-ble";

const markAttendanceBleSchema = z.object({
  sessionId: z.string().min(1),
  token: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  phase: z.enum(["INITIAL", "REVERIFY"]),
  tokenTimestamp: z.number(),
  beaconName: z.string().min(1).optional(),
  bleSignalStrength: z.number().int().min(-110).max(-20).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can mark attendance" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = markAttendanceBleSchema.parse(body);

    const { allowed } = await checkRateLimit(
      session.user.id,
      parsed.sessionId,
      30,
      60
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many submission attempts. Please wait before trying again." },
        { status: 429 }
      );
    }

    const cacheKey = CACHE_KEYS.USER_CREDENTIALS(session.user.id);
    let studentState = await cacheGet<any>(cacheKey);
    if (!studentState) {
      studentState = await db.user.findUnique({
        where: { id: session.user.id },
        select: {
          personalEmail: true,
          personalEmailVerifiedAt: true,
        },
      });
      if (studentState) {
        await cacheSet(cacheKey, studentState, CACHE_TTL.USER_CREDENTIALS);
      }
    }

    if (!studentState?.personalEmail || !studentState.personalEmailVerifiedAt) {
      return NextResponse.json(
        { error: "Complete and verify your personal email before attendance." },
        { status: 403 }
      );
    }

    const credentialCacheKey = `attendance:credential-count:${session.user.id}`;
    let credentialCount = await cacheGet<number>(credentialCacheKey);
    if (credentialCount == null) {
      credentialCount = await db.webAuthnCredential.count({
        where: { userId: session.user.id },
      });
      await cacheSet(credentialCacheKey, credentialCount, 600);
    }

    if (credentialCount === 0) {
      return NextResponse.json(
        { error: "Register a passkey before attendance." },
        { status: 403 }
      );
    }

    const syncedSession = await syncAttendanceSessionState(parsed.sessionId);
    if (!syncedSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (syncedSession.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Session is no longer active" },
        { status: 410 }
      );
    }

    const liveBeacon = await getSessionBleBroadcast(parsed.sessionId);
    if (!liveBeacon) {
      return NextResponse.json(
        { error: "Lecturer BLE beacon is not enabled for this session." },
        { status: 403 }
      );
    }

    const broadcasterPresence = await getBleBroadcasterPresence(parsed.sessionId);
    const broadcasterOnline = Boolean(broadcasterPresence);

    const serverNowTs = Date.now();
    const maxScanAgeMs = syncedSession.qrRotationMs + syncedSession.qrGraceMs;
    const scanAgeMs = serverNowTs - parsed.tokenTimestamp;
    if (scanAgeMs > maxScanAgeMs || scanAgeMs < -1_500) {
      return NextResponse.json(
        { error: "BLE token is out of the allowed validation window. Scan again." },
        { status: 400 }
      );
    }

    const expectedCurrentSequence = getQrSequence(serverNowTs, syncedSession.qrRotationMs);
    const elapsedInCurrentBucket =
      serverNowTs - expectedCurrentSequence * syncedSession.qrRotationMs;
    const allowsPrevious = elapsedInCurrentBucket <= syncedSession.qrGraceMs;
    const isAllowedSequence =
      parsed.sequence === expectedCurrentSequence ||
      (allowsPrevious && parsed.sequence === expectedCurrentSequence - 1);
    if (!isAllowedSequence) {
      return NextResponse.json(
        { error: "BLE token sequence is no longer valid. Re-scan beacon." },
        { status: 400 }
      );
    }

    if (parsed.phase !== syncedSession.phase) {
      return NextResponse.json(
        { error: "BLE token phase does not match active attendance phase." },
        { status: 400 }
      );
    }

    const attendanceSession = await cacheGetOrCompute(
      `attendance:mark-session:${parsed.sessionId}`,
      60,
      async () =>
        db.attendanceSession.findUnique({
          where: { id: parsed.sessionId },
          select: {
            id: true,
            courseId: true,
            qrSecret: true,
            course: {
              select: {
                organization: {
                  select: {
                    settings: true,
                  },
                },
              },
            },
          },
        })
    );
    if (!attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const tokenValid = verifyQrTokenForSequence(
      attendanceSession.qrSecret,
      parsed.token,
      parsed.phase,
      parsed.sequence
    );
    if (!tokenValid) {
      return NextResponse.json(
        { error: "BLE token is invalid for this session window." },
        { status: 400 }
      );
    }

    const enrollmentCacheKey = `attendance:enrollment:${parsed.sessionId}:${session.user.id}`;
    let isEnrolled = await cacheGet<boolean>(enrollmentCacheKey);
    if (isEnrolled == null) {
      const enrollmentCount = await db.enrollment.count({
        where: {
          courseId: attendanceSession.courseId,
          studentId: session.user.id,
        },
      });
      isEnrolled = enrollmentCount > 0;
      await cacheSet(enrollmentCacheKey, isEnrolled, 60);
    }
    if (!isEnrolled) {
      return NextResponse.json(
        { error: "You are not enrolled in this course" },
        { status: 403 }
      );
    }

    const existing = await db.attendanceRecord.findUnique({
      where: {
        sessionId_studentId: {
          sessionId: parsed.sessionId,
          studentId: session.user.id,
        },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "You have already marked attendance for this session" },
        { status: 409 }
      );
    }

    const webauthnUsed = body.webauthnVerified === true;
    const userAgent = request.headers.get("user-agent") ?? "";
    const rawDeviceToken =
      typeof body.deviceToken === "string" ? body.deviceToken.trim() : "";
    const fallbackTokenSource = `${session.user.id}:${userAgent || "unknown-user-agent"}`;
    const fallbackDeviceToken = `web-${createHash("sha256")
      .update(fallbackTokenSource)
      .digest("hex")
      .slice(0, 40)}`;
    const deviceToken = rawDeviceToken || fallbackDeviceToken;

    const resolvedDeviceType =
      body.deviceType === "iOS" ||
      body.deviceType === "Android" ||
      body.deviceType === "Web"
        ? body.deviceType
        : /android/i.test(userAgent)
          ? "Android"
          : /(iphone|ipad|ipod)/i.test(userAgent)
            ? "iOS"
            : "Web";

    const resolvedDeviceName =
      typeof body.deviceName === "string" && body.deviceName.trim().length > 0
        ? body.deviceName.trim().slice(0, 120)
        : userAgent
          ? userAgent.slice(0, 120)
          : "Unknown Device";

    const deviceLinkResult = await linkDevice(session.user.id, deviceToken, {
      deviceName: resolvedDeviceName,
      deviceType: resolvedDeviceType,
      osVersion: body.osVersion,
      appVersion: body.appVersion,
      fingerprint: body.deviceFingerprint,
      bleSignature: body.bleSignature,
    });
    const deviceConsistency = await getDeviceConsistencyScore(
      session.user.id,
      deviceToken
    );
    const deviceMismatch = deviceConsistency < 50 && !deviceLinkResult.trustedAt;

    const bleStats = rawDeviceToken
      ? await getDeviceBleStats(deviceLinkResult.id)
      : {
          averageRssi: null,
          verificationCount: 0,
          lastVerified: null,
          distanceMeters: 0,
        };

    const resolvedBleSignalStrength =
      parsed.bleSignalStrength !== undefined && parsed.bleSignalStrength !== 0
        ? parsed.bleSignalStrength
        : bleStats.averageRssi !== null &&
            bleStats.averageRssi !== undefined &&
            bleStats.averageRssi !== 0
          ? bleStats.averageRssi
          : -65;

    const confidence = calculateConfidence({
      webauthnVerified: webauthnUsed,
      gpsWithinRadius: null,
      qrTokenValid: null,
      bleProximityVerified: true,
      bleSignalStrength: resolvedBleSignalStrength,
      gpsVelocityAnomaly: false,
      deviceConsistency,
      deviceMismatch,
      locationJump: false,
    });

    const settings = attendanceSession.course.organization.settings as any;
    const threshold = settings?.confidenceThreshold || 70;
    const hasAnomalies = deviceMismatch;
    const flagged = isFlagged(confidence, threshold, hasAnomalies);

    const record = await db.attendanceRecord.create({
      data: {
        sessionId: parsed.sessionId,
        studentId: session.user.id,
        gpsLat: 0,
        gpsLng: 0,
        gpsDistance: 0,
        qrToken: parsed.token,
        webauthnUsed,
        reverifyRequired: false,
        reverifyStatus: "NOT_REQUIRED",
        confidence,
        flagged,
        deviceToken,
        bleSignalStrength: resolvedBleSignalStrength,
        deviceConsistency,
        gpsVelocity: null,
        anomalyScore: hasAnomalies ? Math.max(0, 100 - confidence) : 0,
      },
    });

    if (hasAnomalies && flagged) {
      await db.attendanceAnomaly.createMany({
        data: [
          {
            studentId: session.user.id,
            sessionId: parsed.sessionId,
            anomalyType: "DEVICE_MISMATCH",
            severity: 40,
            confidence: deviceConsistency / 100,
            details: {
              consistency: deviceConsistency,
              isNewDevice: deviceLinkResult.isNewDevice,
              source: "BLE_TOKEN_ATTENDANCE",
              beaconName: parsed.beaconName ?? null,
              broadcasterOnline,
            },
          } as any,
        ],
      });
    }

    await cacheDel(CACHE_KEYS.SESSION_STATE(parsed.sessionId));
    await cacheDel(`attendance:session-me:${parsed.sessionId}:${session.user.id}`);
    await cacheDel(`attendance:sessions:list:STUDENT:${session.user.id}:ACTIVE`);
    await cacheDel(`student:live-sessions:${session.user.id}`);
    await cacheDel(`attendance:enrollment:${parsed.sessionId}:${session.user.id}`);

    return NextResponse.json({
      success: true,
      record: {
        id: record.id,
        confidence: record.confidence,
        flagged: record.flagged,
        gpsDistance: record.gpsDistance,
        layers: {
          webauthn: webauthnUsed,
          gps: true,
          qr: tokenValid,
          ble: true,
          deviceConsistent: !deviceMismatch,
        },
        anomalies: {
          velocityAnomaly: false,
          locationJump: false,
          deviceMismatch,
        },
      },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: ApiErrorMessages.INVALID_INPUT },
        { status: 400 }
      );
    }
    if (error instanceof DeviceTokenConflictError) {
      return NextResponse.json(
        {
          error:
            "This device is already linked to another student account. Use your own device or contact admin to reset device access.",
        },
        { status: 409 }
      );
    }
    logError("attendance/ble-mark", error, { userId: session.user.id });
    return NextResponse.json(
      { error: ApiErrorMessages.SERVER_ERROR },
      { status: 500 }
    );
  }
}
