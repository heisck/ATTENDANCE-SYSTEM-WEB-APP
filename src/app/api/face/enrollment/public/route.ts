import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logError } from "@/lib/api-error";
import { describeEnrollmentToken, FaceFlowError } from "@/lib/face";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token")?.trim() || "";

  try {
    const session = await auth();
    const details = await describeEnrollmentToken(token);

    return NextResponse.json({
      studentName: details.studentName,
      expiresAt: details.expiresAt.toISOString(),
      hasCompletedEnrollment: details.hasCompletedEnrollment,
      profileImageUrl: details.profileImageUrl,
      sameStudentSignedIn: session?.user?.id === details.userId,
    });
  } catch (error) {
    if (error instanceof FaceFlowError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logError("face/enrollment/public GET", error, {
      hasToken: token.length > 0,
    });

    return NextResponse.json(
      { error: "Unable to validate the face enrollment link." },
      { status: 500 }
    );
  }
}
