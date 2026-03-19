import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getQrSequence, verifyBleTokenForSequence } from "@/lib/qr";
import { logError, ApiErrorMessages } from "@/lib/api-error";
import { setBrowserDeviceProofCookie } from "@/lib/browser-device-proof";
import { SharedRedisRequiredError } from "@/lib/cache";
import {
  AttendanceRequestError,
  BrowserDeviceVerificationError,
  buildAttendanceMark,
  DeviceTokenConflictError,
  executeAttendanceMark,
  prepareAttendanceMarkContext,
} from "@/lib/attendance-marking";
import { getFreshBleRelayLease, getSessionBleBroadcast } from "@/lib/lecturer-ble";

const markAttendanceBleSchema = z.object({
  sessionId: z.string().min(1),
  token: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  phase: z.enum(["PHASE_ONE", "PHASE_TWO"]),
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
    const context = await prepareAttendanceMarkContext({
      request,
      studentId: session.user.id,
      sessionId: parsed.sessionId,
    });

    const liveBeacon = await getSessionBleBroadcast(parsed.sessionId);
    if (!liveBeacon) {
      return NextResponse.json(
        { error: "Lecturer BLE beacon is not enabled for this session." },
        { status: 403 }
      );
    }

    const broadcasterLease = await getFreshBleRelayLease(parsed.sessionId);
    if (!broadcasterLease) {
      return NextResponse.json(
        {
          error:
            "Lecturer BLE heartbeat is required before relay attendance can be marked.",
        },
        { status: 403 }
      );
    }

    const serverNowTs = Date.now();
    const maxScanAgeMs =
      context.syncedSession.qrRotationMs + context.syncedSession.qrGraceMs;
    const scanAgeMs = serverNowTs - parsed.tokenTimestamp;
    if (scanAgeMs > maxScanAgeMs || scanAgeMs < -1_500) {
      return NextResponse.json(
        { error: "BLE token is out of the allowed validation window. Scan again." },
        { status: 400 }
      );
    }

    const expectedCurrentSequence = getQrSequence(
      serverNowTs,
      context.syncedSession.qrRotationMs
    );
    const elapsedInCurrentBucket =
      serverNowTs - expectedCurrentSequence * context.syncedSession.qrRotationMs;
    const allowsPrevious = elapsedInCurrentBucket <= context.syncedSession.qrGraceMs;
    const isAllowedSequence =
      parsed.sequence === expectedCurrentSequence ||
      (allowsPrevious && parsed.sequence === expectedCurrentSequence - 1);
    if (!isAllowedSequence) {
      return NextResponse.json(
        { error: "BLE token sequence is no longer valid. Re-scan beacon." },
        { status: 400 }
      );
    }

    if (parsed.phase !== context.syncedSession.phase) {
      return NextResponse.json(
        { error: "BLE token phase does not match active attendance phase." },
        { status: 400 }
      );
    }

    const tokenValid = verifyBleTokenForSequence(
      context.attendanceSession.qrSecret,
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

    if (context.syncedSession.phase === "PHASE_ONE") {
      const built = await buildAttendanceMark({
        request,
        studentId: session.user.id,
        context,
        body,
        recordQrToken: parsed.token,
        buildSecurity: () => ({
          confidenceInput: {
            qrTokenValid: null,
            bleProximityVerified: true,
            bleSignalStrength: null,
          },
          responseLayers: {
            qr: null,
            ble: true,
          },
          recordBleSignalStrength: null,
          anomalyDetails: {
            source: "BLE_TOKEN_ATTENDANCE",
            beaconName: parsed.beaconName ?? null,
            relayLeaseActive: true,
          },
        }),
      });

      const pendingTtlSeconds = Number(process.env.PENDING_FACE_VERIFICATION_TTL_SECONDS);
      const provisionalExpiresAt = new Date(
        Math.min(
          context.attendanceSession.endsAt.getTime(),
          Date.now() +
            ((Number.isFinite(pendingTtlSeconds) && pendingTtlSeconds > 0
              ? pendingTtlSeconds
              : 300) *
              1000)
        )
      );

      await db.pendingAttendanceFaceVerification.updateMany({
        where: {
          userId: session.user.id,
          sessionId: context.attendanceSession.id,
          consumedAt: null,
        },
        data: {
          consumedAt: new Date(),
        },
      });

      const pending = await db.pendingAttendanceFaceVerification.create({
        data: {
          userId: session.user.id,
          sessionId: context.attendanceSession.id,
          sessionFamilyId: context.attendanceSession.sessionFamilyId,
          phase: context.syncedSession.phase,
          source: "BLE",
          qrToken: built.recordData.qrToken,
          confidence: built.confidence,
          flagged: built.flagged,
          deviceToken: built.recordData.deviceToken,
          bleSignalStrength: built.recordData.bleSignalStrength,
          deviceConsistency: built.recordData.deviceConsistency,
          anomalyScore: built.recordData.anomalyScore,
          responseLayers: built.responseLayers as Prisma.InputJsonValue,
          anomalyDetails: (built.anomalyDetails ?? {}) as Prisma.InputJsonValue,
          expiresAt: provisionalExpiresAt,
        },
      });

      const response = NextResponse.json({
        success: true,
        provisional: true,
        requiresFaceVerification: true,
        pendingVerificationId: pending.id,
        expiresAt: pending.expiresAt.toISOString(),
        layers: {
          ...built.responseLayers,
          face: null,
        },
      });

      if (built.browserDeviceBinding) {
        setBrowserDeviceProofCookie(response, {
          userId: session.user.id,
          deviceToken: built.browserDeviceBinding.deviceToken,
          fingerprintHash: built.browserDeviceBinding.fingerprintHash,
        });
      }

      return response;
    }

    const result = await executeAttendanceMark({
      request,
      studentId: session.user.id,
      context,
      body,
      recordQrToken: parsed.token,
      buildSecurity: () => ({
        confidenceInput: {
          qrTokenValid: null,
          bleProximityVerified: true,
          bleSignalStrength: null,
        },
        responseLayers: {
          qr: null,
          ble: true,
        },
        recordBleSignalStrength: null,
        anomalyDetails: {
          source: "BLE_TOKEN_ATTENDANCE",
          beaconName: parsed.beaconName ?? null,
          relayLeaseActive: true,
        },
      }),
    });

    const response = NextResponse.json({
      success: true,
      record: {
        id: result.record.id,
        confidence: result.confidence,
        flagged: result.flagged,
        layers: result.responseLayers,
        anomalies: {
          deviceMismatch: result.deviceMismatch,
        },
        faceVerified: result.record.faceVerified,
      },
      phaseCompletion: result.phaseCompletion,
    });

    if (result.browserDeviceBinding) {
      setBrowserDeviceProofCookie(response, {
        userId: session.user.id,
        deviceToken: result.browserDeviceBinding.deviceToken,
        fingerprintHash: result.browserDeviceBinding.fingerprintHash,
      });
    }

    return response;
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: ApiErrorMessages.INVALID_INPUT },
        { status: 400 }
      );
    }
    if (error instanceof AttendanceRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
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
    if (error instanceof BrowserDeviceVerificationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof SharedRedisRequiredError) {
      return NextResponse.json(
        {
          error:
            "Attendance service is temporarily unavailable. Please try again shortly.",
        },
        { status: 503 }
      );
    }
    logError("attendance/ble-mark", error, { userId: session.user.id });
    return NextResponse.json(
      { error: ApiErrorMessages.SERVER_ERROR },
      { status: 500 }
    );
  }
}
