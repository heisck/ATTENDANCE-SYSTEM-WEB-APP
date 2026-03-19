import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { issueEnrollmentFaceFlowToken } from "@/lib/face";
import { getStudentGateState } from "@/lib/student-gates";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can start face enrollment." },
      { status: 403 }
    );
  }

  const gate = await getStudentGateState(session.user.id);
  if (gate.requiresProfileCompletion || gate.requiresEmailVerification) {
    return NextResponse.json(
      { error: "Complete and verify your personal email before face enrollment." },
      { status: 403 }
    );
  }

  const payload = await issueEnrollmentFaceFlowToken(session.user.id);
  return NextResponse.json({
    token: payload.token,
    url: `/face-enroll?token=${encodeURIComponent(payload.token)}`,
    expiresAt: payload.expiresAt.toISOString(),
  });
}
