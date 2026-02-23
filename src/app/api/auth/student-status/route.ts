import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json({
      role: user.role,
      requiresProfileCompletion: false,
      personalEmailVerified: true,
      hasPasskey: true,
      canProceed: true,
    });
  }

  const [student, credentialCount] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: {
        personalEmail: true,
        personalEmailVerifiedAt: true,
      },
    }),
    db.webAuthnCredential.count({
      where: { userId: user.id },
    }),
  ]);

  if (!student) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const requiresProfileCompletion = !student.personalEmail;
  const personalEmailVerified = Boolean(student.personalEmailVerifiedAt);
  const hasPasskey = credentialCount > 0;
  const canProceed = !requiresProfileCompletion && personalEmailVerified && hasPasskey;

  return NextResponse.json({
    role: user.role,
    requiresProfileCompletion,
    personalEmailVerified,
    hasPasskey,
    canProceed,
  });
}
