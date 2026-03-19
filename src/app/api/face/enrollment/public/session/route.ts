import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logError } from "@/lib/api-error";
import { createEnrollmentLivenessCapture, FaceFlowError } from "@/lib/face";

const schema = z.object({
  token: z.string().min(16),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = schema.parse(body);
    const capture = await createEnrollmentLivenessCapture(parsed.token);

    return NextResponse.json(capture);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid face enrollment request." }, { status: 400 });
    }
    if (error instanceof FaceFlowError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logError("face/enrollment/public/session POST", error);

    return NextResponse.json(
      { error: "Unable to start face enrollment right now." },
      { status: 500 }
    );
  }
}
