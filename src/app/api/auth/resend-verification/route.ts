import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      role: true,
      name: true,
      personalEmail: true,
      personalEmailVerifiedAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can request personal-email verification" },
      { status: 403 }
    );
  }

  if (!user.personalEmail) {
    return NextResponse.json(
      { error: "Set your personal email first before requesting verification" },
      { status: 400 }
    );
  }

  if (user.personalEmailVerifiedAt) {
    return NextResponse.json({ success: true, message: "Personal email is already verified." });
  }

  const rawToken = createRawToken();
  const expiresAt = createExpiryDate(1000 * 60 * 60 * 24);

  await db.emailVerificationToken.create({
    data: {
      userId: user.id,
      email: user.personalEmail,
      tokenHash: hashToken(rawToken),
      type: "PERSONAL_EMAIL_VERIFY",
      expiresAt,
    },
  });

  const verifyUrl = buildAppUrl(`/verify-email?token=${encodeURIComponent(rawToken)}`);
  await sendEmail({
    to: user.personalEmail,
    subject: "Verify your AttendanceIQ personal email",
    html: `
      <p>Hello ${user.name},</p>
      <p>Use this link to verify your personal email:</p>
      <p><a href="${verifyUrl}">Verify personal email</a></p>
      <p>This link expires on ${expiresAt.toUTCString()}.</p>
    `,
    text: `Verify your personal email: ${verifyUrl}`,
  });

  return NextResponse.json({ success: true });
}
