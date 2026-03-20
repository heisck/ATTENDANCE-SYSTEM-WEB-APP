import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/api-error";
import { FaceFlowError, finalizeEnrollmentLivenessCapture } from "@/lib/face";
import {
  buildFaceRateLimitMessage,
  checkFaceRateLimit,
} from "@/lib/face-rate-limit";

const schema = z.object({
  token: z.string().min(16),
  livenessSessionId: z.string().min(10),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = schema.parse(body);
    const rateLimit = await checkFaceRateLimit({
      scope: "enrollment-finalize",
      identifier: `${session.user.id}:${parsed.token}`,
      maxAttempts: 5,
      windowSeconds: 600,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: buildFaceRateLimitMessage("face enrollment", 600),
        },
        { status: 429 }
      );
    }

    // SECURITY: Verify the enrollment token belongs to the authenticated user BEFORE enrollment
    // This prevents biometric outsourcing attacks where attacker enrolls own face for victim's account
    const result = await finalizeEnrollmentLivenessCapture({
      rawToken: parsed.token,
      livenessSessionId: parsed.livenessSessionId,
      enforcedUserId: session.user.id, // Enforce token must match authenticated user
    });

    // This secondary check is now redundant but kept for defense-in-depth
    if (session.user.id !== result.userId) {
      return NextResponse.json({ error: "Unauthorized. You cannot enroll a face for another user." }, { status: 403 });
    }

    const credentialCount = await db.webAuthnCredential.count({
      where: { userId: result.userId },
    });

    return NextResponse.json({
      success: true,
      profileImageUrl: result.profileImageUrl,
      continueUrl: credentialCount > 0 ? "/student" : "/setup-device",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid face enrollment request." }, { status: 400 });
    }
    if (error instanceof FaceFlowError) {
      logError("face/enrollment/public/finalize POST", error, {
        handled: true,
        status: error.status,
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logError("face/enrollment/public/finalize POST", error);

    return NextResponse.json(
      { error: "Unable to finalize face enrollment." },
      { status: 500 }
    );
  }
}
