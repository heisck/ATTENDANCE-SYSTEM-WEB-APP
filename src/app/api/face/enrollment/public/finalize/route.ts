import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/api-error";
import { FaceFlowError, finalizeEnrollmentLivenessCapture } from "@/lib/face";

const schema = z.object({
  token: z.string().min(16),
  livenessSessionId: z.string().min(10),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const body = await request.json();
    const parsed = schema.parse(body);
    const result = await finalizeEnrollmentLivenessCapture({
      rawToken: parsed.token,
      livenessSessionId: parsed.livenessSessionId,
    });

    const credentialCount = await db.webAuthnCredential.count({
      where: { userId: result.userId },
    });

    return NextResponse.json({
      success: true,
      profileImageUrl: result.profileImageUrl,
      continueUrl:
        session?.user?.id === result.userId
          ? credentialCount > 0
            ? "/student"
            : "/setup-device"
          : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid face enrollment request." }, { status: 400 });
    }
    if (error instanceof FaceFlowError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logError("face/enrollment/public/finalize POST", error);

    return NextResponse.json(
      { error: "Unable to finalize face enrollment." },
      { status: 500 }
    );
  }
}
