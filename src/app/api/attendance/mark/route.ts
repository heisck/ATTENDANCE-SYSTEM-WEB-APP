import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { verifyQrTokenStrict } from "@/lib/qr";
import { logError, ApiErrorMessages } from "@/lib/api-error";
import { setBrowserDeviceProofCookie } from "@/lib/browser-device-proof";
import { SharedRedisRequiredError } from "@/lib/cache";
import {
  AttendanceRequestError,
  BrowserDeviceVerificationError,
  DeviceTokenConflictError,
  executeAttendanceMark,
  prepareAttendanceMarkContext,
} from "@/lib/attendance-marking";
import { markAttendanceSchema } from "@/lib/validators";

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
    const parsed = markAttendanceSchema.parse(body);
    const scanTimestamp = Number(parsed.qrTimestamp);

    if (!Number.isFinite(scanTimestamp)) {
      return NextResponse.json({ error: "Invalid QR timestamp" }, { status: 400 });
    }

    const context = await prepareAttendanceMarkContext({
      request,
      studentId: session.user.id,
      sessionId: parsed.sessionId,
    });

    const serverNowTs = Date.now();
    const maxScanAgeMs =
      context.syncedSession.qrRotationMs + context.syncedSession.qrGraceMs;
    const scanAgeMs = serverNowTs - scanTimestamp;
    if (scanAgeMs > maxScanAgeMs || scanAgeMs < -1_500) {
      return NextResponse.json(
        {
          error: "QR scan is out of the allowed 6-second validation window. Scan again.",
        },
        { status: 400 }
      );
    }

    const qrValid = verifyQrTokenStrict(
      context.attendanceSession.qrSecret,
      parsed.qrToken,
      context.syncedSession.phase,
      serverNowTs,
      context.syncedSession.qrRotationMs,
      context.syncedSession.qrGraceMs
    );
    if (!qrValid) {
      return NextResponse.json(
        { error: "QR is expired or invalid for the current time window" },
        { status: 400 }
      );
    }

    const result = await executeAttendanceMark({
      request,
      studentId: session.user.id,
      context,
      body,
      recordQrToken: parsed.qrToken,
      buildSecurity: () => {
        return {
          confidenceInput: {
            qrTokenValid: true,
            bleProximityVerified: null,
            bleSignalStrength: null,
          },
          responseLayers: {
            qr: true,
            ble: null,
          },
          recordBleSignalStrength: null,
        };
      },
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
    logError("attendance/mark", error, { userId: session.user.id });
    return NextResponse.json(
      { error: ApiErrorMessages.SERVER_ERROR },
      { status: 500 }
    );
  }
}
