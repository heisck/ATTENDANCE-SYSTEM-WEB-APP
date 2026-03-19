import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createAttendanceFaceVerificationCapture,
  FaceFlowError,
} from "@/lib/face";

const schema = z.object({
  pendingVerificationId: z.string().min(10),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can start attendance face verification." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = schema.parse(body);
    const capture = await createAttendanceFaceVerificationCapture({
      userId: session.user.id,
      pendingVerificationId: parsed.pendingVerificationId,
    });

    return NextResponse.json(capture);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid face verification request." }, { status: 400 });
    }
    if (error instanceof FaceFlowError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to start attendance face verification." },
      { status: 500 }
    );
  }
}
