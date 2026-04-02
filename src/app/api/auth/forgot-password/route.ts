import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forgotPasswordSchema } from "@/lib/validators";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { passwordResetEmailHtml } from "@/lib/email-templates";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";
import { checkRateLimitKey } from "@/lib/cache";

const RESET_IP_MAX_ATTEMPTS = 5;
const RESET_EMAIL_MAX_ATTEMPTS = 3;
const RESET_WINDOW_SECONDS = 15 * 60;

function getClientIp(request: NextRequest): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "";
  if (!ip) {
    console.warn("[forgot-password] Could not resolve client IP from request headers");
  }
  return ip || "unknown";
}

const UNKNOWN_IP_MAX_ATTEMPTS = 2;

async function sendResetEmail(targetEmail: string, name: string, resetUrl: string, expiresAt: Date) {
  await sendEmail({
    to: targetEmail,
    subject: "Reset your ATTENDANCE IQ password",
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
    // Rate limit password reset by IP and email
    const clientIp = getClientIp(request);
    const ipLimit = clientIp === "unknown" ? UNKNOWN_IP_MAX_ATTEMPTS : RESET_IP_MAX_ATTEMPTS;
    try {
      const { allowed } = await checkRateLimitKey(
        `reset-ratelimit:ip:${clientIp}`,
        ipLimit,
        RESET_WINDOW_SECONDS
      );
      if (!allowed) {
        // Still return success to prevent enumeration, but don't send email
        return NextResponse.json({
          success: true,
          message: "If the email exists, a reset link has been sent.",
        });
      }
    } catch (err) {
      console.error("[forgot-password] IP rate limit check failed:", err);
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json({
          success: true,
          message: "If the email exists, a reset link has been sent.",
        });
      }
    }

    const body = await request.json();
    const parsed = forgotPasswordSchema.parse(body);
    const email = parsed.email.trim().toLowerCase();

    try {
      const { allowed } = await checkRateLimitKey(
        `reset-ratelimit:email:${email}`,
        RESET_EMAIL_MAX_ATTEMPTS,
        RESET_WINDOW_SECONDS
      );
      if (!allowed) {
        return NextResponse.json({
          success: true,
          message: "If the email exists, a reset link has been sent.",
        });
      }
    } catch (err) {
      console.error("[forgot-password] Email rate limit check failed:", err);
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json({
          success: true,
          message: "If the email exists, a reset link has been sent.",
        });
      }
    }

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
          {
            success: true,
            message: "If the email exists, a reset link has been sent.",
          }
        );
      }
      deliveryEmail = user.personalEmail;
    }

    const rawToken = createRawToken();
    const expiresAt = createExpiryDate(1000 * 60 * 30); // 30 minutes

    await db.$transaction([
      db.passwordResetToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      }),
      db.passwordResetToken.create({
        data: {
          userId: user.id,
          email: deliveryEmail,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
      }),
    ]);

    const resetUrl = buildAppUrl(`/reset-password?token=${encodeURIComponent(rawToken)}`);
    await sendResetEmail(deliveryEmail, user.name, resetUrl, expiresAt);

    return NextResponse.json({
      success: true,
      message: "If the email exists, a reset link has been sent.",
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid request payload." },
        { status: 400 }
      );
    }
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
