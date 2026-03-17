import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getQrSequence, verifyQrTokenForSequence } from "@/lib/qr";
import { logError, ApiErrorMessages } from "@/lib/api-error";
import { SharedRedisRequiredError } from "@/lib/cache";
import {
  AttendanceRequestError,
  DeviceTokenConflictError,
  executeAttendanceMark,
  prepareAttendanceMarkContext,
} from "@/lib/attendance-marking";
import {
  getBleBroadcasterPresence,
  getSessionBleBroadcast,
} from "@/lib/lecturer-ble";

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

    const broadcasterPresence = await getBleBroadcasterPresence(parsed.sessionId);
    const broadcasterOnline = Boolean(broadcasterPresence);

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

    const tokenValid = verifyQrTokenForSequence(
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

    const result = await executeAttendanceMark({
      request,
      studentId: session.user.id,
      context,
      body,
      recordQrToken: parsed.token,
      buildSecurity: ({ bleStats }) => {
        const resolvedBleSignalStrength =
          parsed.bleSignalStrength !== undefined && parsed.bleSignalStrength !== 0
            ? parsed.bleSignalStrength
            : bleStats.averageRssi !== null &&
                bleStats.averageRssi !== undefined &&
                bleStats.averageRssi !== 0
              ? bleStats.averageRssi
              : -65;

        return {
          confidenceInput: {
            qrTokenValid: null,
            bleProximityVerified: true,
            bleSignalStrength: resolvedBleSignalStrength,
          },
          responseLayers: {
            qr: tokenValid,
            ble: true,
          },
          recordBleSignalStrength: resolvedBleSignalStrength,
          anomalyDetails: {
            source: "BLE_TOKEN_ATTENDANCE",
            beaconName: parsed.beaconName ?? null,
            broadcasterOnline,
          },
        };
      },
    });

    return NextResponse.json({
      success: true,
      record: {
        id: result.record.id,
        confidence: result.confidence,
        flagged: result.flagged,
        layers: result.responseLayers,
        anomalies: {
          deviceMismatch: result.deviceMismatch,
        },
      },
      phaseCompletion: result.phaseCompletion,
    });
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
