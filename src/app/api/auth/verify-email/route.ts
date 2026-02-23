import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Verification token is required" }, { status: 400 });
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  const verification = await db.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          personalEmail: true,
        },
      },
    },
  });

  if (
    !verification ||
    verification.usedAt ||
    verification.expiresAt < now ||
    verification.type !== "PERSONAL_EMAIL_VERIFY"
  ) {
    return NextResponse.json({ error: "Verification link is invalid or expired" }, { status: 400 });
  }

  if (!verification.user || verification.user.personalEmail !== verification.email) {
    return NextResponse.json(
      { error: "Verification link does not match your current personal email" },
      { status: 400 }
    );
  }

  await db.$transaction([
    db.user.update({
      where: { id: verification.userId },
      data: { personalEmailVerifiedAt: now },
    }),
    db.emailVerificationToken.update({
      where: { id: verification.id },
      data: { usedAt: now },
    }),
  ]);

  return NextResponse.json({ success: true });
}
