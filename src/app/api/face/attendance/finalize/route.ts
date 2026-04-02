import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  AttendanceAlreadyMarkedError,
  persistAttendanceMark,
  prepareAttendanceMarkContext,
  type BuiltAttendanceMark,
} from "@/lib/attendance-marking";
import { FaceFlowError, performAttendanceFaceVerification } from "@/lib/face";
import {
  buildFaceRateLimitMessage,
  checkFaceRateLimit,
} from "@/lib/face-rate-limit";

const schema = z.object({
  pendingVerificationId: z.string().min(10),
  livenessSessionId: z.string().min(10),
});

function parseBooleanOrNull(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can finalize attendance face verification." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = schema.parse(body);
    const rateLimit = await checkFaceRateLimit({
      scope: "attendance-finalize",
      identifier: `${session.user.id}:${parsed.pendingVerificationId}`,
      maxAttempts: 5,
      windowSeconds: 300,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: buildFaceRateLimitMessage(
            "attendance face verification",
            300
          ),
        },
        { status: 429 }
      );
    }
    const verification = await performAttendanceFaceVerification({
      userId: session.user.id,
      pendingVerificationId: parsed.pendingVerificationId,
      livenessSessionId: parsed.livenessSessionId,
    });

    const responseLayers =
      verification.pending.responseLayers &&
      typeof verification.pending.responseLayers === "object"
        ? (verification.pending.responseLayers as Record<string, unknown>)
        : {};
    const anomalyDetails =
      verification.pending.anomalyDetails &&
      typeof verification.pending.anomalyDetails === "object"
        ? (verification.pending.anomalyDetails as Record<string, unknown>)
        : {};

    const context = await prepareAttendanceMarkContext({
      request,
      studentId: session.user.id,
      sessionId: verification.pending.sessionId,
      phaseOverride: "PHASE_ONE",
      allowClosedSessionForPhaseFinalization: true,
    });

    const built: BuiltAttendanceMark = {
      recordData: {
        sessionId: verification.pending.sessionId,
        studentId: session.user.id,
        qrToken: verification.pending.qrToken,
        webauthnUsed: true,
        confidence: verification.pending.confidence,
        flagged: verification.pending.flagged,
        deviceToken: verification.pending.deviceToken,
        bleSignalStrength: verification.pending.bleSignalStrength,
        deviceConsistency: verification.pending.deviceConsistency ?? 100,
        anomalyScore: verification.pending.anomalyScore ?? 0,
      },
      phaseCompletion: null,
      flagged: verification.pending.flagged,
      confidence: verification.pending.confidence,
      deviceMismatch:
        (verification.pending.deviceConsistency ?? 100) < 50 && verification.pending.flagged,
      deviceConsistency: verification.pending.deviceConsistency ?? 100,
      anomalyDetails,
      responseLayers: {
        webauthn: true,
        qr:
          parseBooleanOrNull(responseLayers.qr) ??
          (verification.pending.source === "QR" ? true : null),
        ble:
          parseBooleanOrNull(responseLayers.ble) ??
          (verification.pending.source === "BLE" ? true : null),
        deviceConsistent:
          parseBooleanOrNull(responseLayers.deviceConsistent) ??
          !((verification.pending.deviceConsistency ?? 100) < 50),
        face: true,
      },
      browserDeviceBinding: null,
      deviceLinkResult: null,
    };

    const persisted = await persistAttendanceMark({
      studentId: session.user.id,
      context,
      built,
      faceVerified: true,
      consumePendingVerificationId: verification.pending.id,
    });

    return NextResponse.json({
      success: true,
      record: {
        id: persisted.record.id,
        confidence: persisted.record.confidence,
        flagged: persisted.record.flagged,
        faceVerified: persisted.record.faceVerified,
        layers: persisted.responseLayers,
      },
      phaseCompletion: persisted.phaseCompletion,
      verification: {
        livenessScore: verification.livenessScore,
        faceSimilarity: verification.faceSimilarity,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid face verification request." }, { status: 400 });
    }
    if (error instanceof AttendanceAlreadyMarkedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FaceFlowError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to finalize attendance face verification." },
      { status: 500 }
    );
  }
}
