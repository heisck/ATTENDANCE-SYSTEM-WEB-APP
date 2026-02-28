import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncAttendanceSessionState } from "@/lib/attendance";
import { markAttendanceSchema } from "@/lib/validators";
import { verifyQrTokenStrict } from "@/lib/qr";
import { isWithinRadius, checkGpsVelocityAnomaly, checkLocationJumpPattern } from "@/lib/gps";
import { calculateConfidence, isFlagged } from "@/lib/confidence";
import { logError, ApiErrorMessages } from "@/lib/api-error";
import {
  checkRateLimit,
  cacheGet,
  cacheSet,
  cacheDel,
  CACHE_KEYS,
  CACHE_TTL,
} from "@/lib/cache";
import {
  DeviceTokenConflictError,
  linkDevice,
  getDeviceConsistencyScore,
} from "@/lib/device-linking";
import { getDeviceBleStats } from "@/lib/ble-verification";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT") {
    return NextResponse.json({ error: "Only students can mark attendance" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = markAttendanceSchema.parse(body);
    const now = new Date();

    // Continuous scan UX may submit multiple rotating tokens while waiting for a valid frame.
    // Keep a guardrail but allow short bursts from mobile cameras.
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

    // Get student state with caching
    const cacheKey = CACHE_KEYS.USER_CREDENTIALS(session.user.id);
    let studentState = await cacheGet<any>(cacheKey);

    if (!studentState) {
      const result = await db.user.findUnique({
        where: { id: session.user.id },
        select: {
          personalEmail: true,
          personalEmailVerifiedAt: true,
        },
      });
      studentState = result;
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

    const credentialCount = await db.webAuthnCredential.count({
      where: { userId: session.user.id },
    });

    if (credentialCount === 0) {
      return NextResponse.json(
        { error: "Register a passkey before attendance." },
        { status: 403 }
      );
    }

    const scanTimestamp = Number(parsed.qrTimestamp);

    if (!Number.isFinite(scanTimestamp)) {
      return NextResponse.json({ error: "Invalid QR timestamp" }, { status: 400 });
    }

    const syncedSession = await syncAttendanceSessionState(parsed.sessionId);
    if (!syncedSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (syncedSession.status !== "ACTIVE") {
      return NextResponse.json({ error: "Session is no longer active" }, { status: 410 });
    }

    if (syncedSession.phase !== "INITIAL") {
      return NextResponse.json(
        { error: "Initial attendance window is closed. Wait for reverification prompts." },
        { status: 410 }
      );
    }

    const serverNowTs = Date.now();
    const maxScanAgeMs = syncedSession.qrRotationMs + syncedSession.qrGraceMs;
    const scanAgeMs = serverNowTs - scanTimestamp;
    if (scanAgeMs > maxScanAgeMs || scanAgeMs < -1_500) {
      return NextResponse.json(
        { error: "QR scan is out of the allowed 6-second validation window. Scan again." },
        { status: 400 }
      );
    }

    const attendanceSession = await db.attendanceSession.findUnique({
      where: { id: parsed.sessionId },
      include: {
        course: {
          include: {
            organization: true,
            enrollments: { where: { studentId: session.user.id } },
          },
        },
      },
    });

    if (!attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (attendanceSession.course.enrollments.length === 0) {
      return NextResponse.json({ error: "You are not enrolled in this course" }, { status: 403 });
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

    const qrValid = verifyQrTokenStrict(
      attendanceSession.qrSecret,
      parsed.qrToken,
      "INITIAL",
      serverNowTs,
      syncedSession.qrRotationMs,
      syncedSession.qrGraceMs
    );
    if (!qrValid) {
      return NextResponse.json(
        { error: "QR is expired or invalid for the current time window" },
        { status: 400 }
      );
    }

    const gpsResult = isWithinRadius(
      parsed.gpsLat,
      parsed.gpsLng,
      attendanceSession.gpsLat,
      attendanceSession.gpsLng,
      attendanceSession.radiusMeters
    );

    const webauthnUsed = body.webauthnVerified === true;
    const userAgent = request.headers.get("user-agent") ?? "";
    const rawDeviceToken = typeof body.deviceToken === "string" ? body.deviceToken.trim() : "";
    const fallbackTokenSource = `${session.user.id}:${userAgent || "unknown-user-agent"}`;
    const fallbackDeviceToken = `web-${createHash("sha256")
      .update(fallbackTokenSource)
      .digest("hex")
      .slice(0, 40)}`;
    const deviceToken = rawDeviceToken || fallbackDeviceToken;

    const resolvedDeviceType =
      body.deviceType === "iOS" || body.deviceType === "Android" || body.deviceType === "Web"
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

    // Device linking and consistency check
    const deviceLinkResult = await linkDevice(session.user.id, deviceToken, {
      deviceName: resolvedDeviceName,
      deviceType: resolvedDeviceType,
      osVersion: body.osVersion,
      appVersion: body.appVersion,
      fingerprint: body.deviceFingerprint,
      bleSignature: body.bleSignature,
    });

    // Get device consistency score (cached)
    const deviceConsistency = await getDeviceConsistencyScore(session.user.id, deviceToken);
    const deviceMismatch = deviceConsistency < 50 && !deviceLinkResult.trustedAt;

    // GPS velocity anomaly detection
    const velocityCheck = await checkGpsVelocityAnomaly(
      session.user.id,
      parsed.gpsLat,
      parsed.gpsLng,
      now
    );

    // Location jump detection
    const jumpCheck = await checkLocationJumpPattern(
      session.user.id,
      parsed.gpsLat,
      parsed.gpsLng
    );

    // Get BLE stats if available
    const bleStats = rawDeviceToken
      ? await getDeviceBleStats(deviceLinkResult.id)
      : { averageRssi: 0, verificationCount: 0, lastVerified: null, distanceMeters: 0 };

    // Enhanced confidence calculation with all security layers
    const confidence = calculateConfidence({
      webauthnVerified: webauthnUsed,
      gpsWithinRadius: gpsResult.within,
      qrTokenValid: qrValid,
      bleProximityVerified: bleStats.verificationCount > 0,
      bleSignalStrength: body.bleSignalStrength,
      gpsVelocityAnomaly: velocityCheck.anomalyDetected,
      deviceConsistency,
      deviceMismatch,
      locationJump: jumpCheck.jump,
    });

    const settings = attendanceSession.course.organization.settings as any;
    const threshold = settings?.confidenceThreshold || 70;
    const hasAnomalies =
      velocityCheck.anomalyDetected || jumpCheck.jump || deviceMismatch;
    const flagged = isFlagged(confidence, threshold, hasAnomalies);

    const record = await db.attendanceRecord.create({
      data: {
        sessionId: parsed.sessionId,
        studentId: session.user.id,
        gpsLat: parsed.gpsLat,
        gpsLng: parsed.gpsLng,
        gpsDistance: gpsResult.distance,
        qrToken: parsed.qrToken,
        webauthnUsed,
        reverifyRequired: false,
        reverifyStatus: "NOT_REQUIRED",
        confidence,
        flagged,
        // New security fields
        deviceToken,
        bleSignalStrength: body.bleSignalStrength,
        deviceConsistency,
        gpsVelocity: velocityCheck.velocity,
        anomalyScore: hasAnomalies ? Math.max(0, 100 - confidence) : 0,
      },
    });

    // Create anomaly records if detected
    if (hasAnomalies && flagged) {
      const anomalies = [];
      if (velocityCheck.anomalyDetected) {
        anomalies.push({
          studentId: session.user.id,
          sessionId: parsed.sessionId,
          anomalyType: "VELOCITY_ANOMALY",
          severity: velocityCheck.severity === "high" ? 80 : 50,
          confidence: 0.85,
          details: {
            velocity: velocityCheck.velocity,
            reason: velocityCheck.reason,
          },
        });
      }
      if (jumpCheck.jump) {
        anomalies.push({
          studentId: session.user.id,
          sessionId: parsed.sessionId,
          anomalyType: "LOCATION_JUMP",
          severity: 75,
          confidence: 0.9,
          details: {
            maxDistance: jumpCheck.maxDistanceMeters,
            message: "Unusual location jump from historical average",
          },
        });
      }
      if (deviceMismatch) {
        anomalies.push({
          studentId: session.user.id,
          sessionId: parsed.sessionId,
          anomalyType: "DEVICE_MISMATCH",
          severity: 40,
          confidence: deviceConsistency / 100,
          details: {
            consistency: deviceConsistency,
            isNewDevice: deviceLinkResult.isNewDevice,
          },
        });
      }

      if (anomalies.length > 0) {
        await db.attendanceAnomaly.createMany({
          data: anomalies as any,
        });
      }
    }

    // Invalidate session cache to update monitoring
    await cacheDel(CACHE_KEYS.SESSION_STATE(parsed.sessionId));

    return NextResponse.json({
      success: true,
      record: {
        id: record.id,
        confidence: record.confidence,
        flagged: record.flagged,
        gpsDistance: record.gpsDistance,
        layers: {
          webauthn: webauthnUsed,
          gps: gpsResult.within,
          qr: qrValid,
          ble: bleStats.verificationCount > 0,
          deviceConsistent: !deviceMismatch,
        },
        anomalies: {
          velocityAnomaly: velocityCheck.anomalyDetected,
          locationJump: jumpCheck.jump,
          deviceMismatch,
        },
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: ApiErrorMessages.INVALID_INPUT }, { status: 400 });
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
    logError("attendance/mark", error, { userId: session.user.id });
    return NextResponse.json(
      { error: ApiErrorMessages.SERVER_ERROR },
      { status: 500 }
    );
  }
}
