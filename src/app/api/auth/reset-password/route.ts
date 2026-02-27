import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { resetPasswordSchema } from "@/lib/validators";
import { hashToken } from "@/lib/tokens";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = resetPasswordSchema.parse(body);

    const tokenHash = hashToken(parsed.token.trim());
    const now = new Date();
    const resetToken = await db.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            personalEmail: true,
            personalEmailVerifiedAt: true,
          },
        },
      },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < now || !resetToken.user) {
      return NextResponse.json({ error: "Reset token is invalid or expired" }, { status: 400 });
    }

    if (
      resetToken.user.role === "STUDENT" &&
      (!resetToken.user.personalEmail || !resetToken.user.personalEmailVerifiedAt)
    ) {
      return NextResponse.json(
        { error: "Student personal email must remain verified to reset password." },
        { status: 400 }
      );
    }

    const passwordHash = await hash(parsed.password, 10);
    await db.$transaction([
      db.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      db.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: now },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid request payload." },
        { status: 400 }
      );
    }
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
