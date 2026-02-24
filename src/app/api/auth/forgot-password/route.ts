import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forgotPasswordSchema } from "@/lib/validators";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { passwordResetEmailHtml } from "@/lib/email-templates";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";

async function sendResetEmail(targetEmail: string, name: string, resetUrl: string, expiresAt: Date) {
  await sendEmail({
    to: targetEmail,
    subject: "Reset your AttendanceIQ password",
    html: passwordResetEmailHtml({
      recipientName: name,
      resetUrl,
      expiresAt,
    }),
    text: `Reset your password: ${resetUrl}`,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = forgotPasswordSchema.parse(body);
    const email = parsed.email.trim().toLowerCase();

    const user =
      (await db.user.findUnique({ where: { email } })) ||
      (await db.user.findUnique({ where: { personalEmail: email } }));

    // Always return success to avoid account enumeration.
    if (!user) {
      return NextResponse.json({
        success: true,
        message: "If the email exists, a reset link has been sent.",
      });
    }

    if (user.role === "SUPER_ADMIN") {
      return NextResponse.json({
        success: true,
        message: "If the email exists, a reset link has been sent.",
      });
    }

    let deliveryEmail = user.email;
    if (user.role === "STUDENT") {
      if (!user.personalEmail || !user.personalEmailVerifiedAt) {
        return NextResponse.json(
          { error: "Your personal email must be verified before password reset." },
          { status: 400 }
        );
      }
      deliveryEmail = user.personalEmail;
    }

    const rawToken = createRawToken();
    const expiresAt = createExpiryDate(1000 * 60 * 30); // 30 minutes

    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        email: deliveryEmail,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });

    const resetUrl = buildAppUrl(`/reset-password?token=${encodeURIComponent(rawToken)}`);
    await sendResetEmail(deliveryEmail, user.name, resetUrl, expiresAt);

    return NextResponse.json({
      success: true,
      message: "If the email exists, a reset link has been sent.",
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
