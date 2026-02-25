import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { verificationEmailHtml } from "@/lib/email-templates";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";

const updateStudentProfileSchema = z.object({
  personalEmail: z.string().email("Invalid personal email"),
});

export async function GET() {
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
      email: true,
      studentId: true,
      indexNumber: true,
      personalEmail: true,
      personalEmailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json(user);
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = updateStudentProfileSchema.parse(body);
    const personalEmail = parsed.personalEmail.trim().toLowerCase();

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, role: true, email: true, name: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.role !== "STUDENT") {
      return NextResponse.json({ error: "Only students can update this profile." }, { status: 403 });
    }

    if (personalEmail === user.email.toLowerCase()) {
      return NextResponse.json(
        { error: "Personal email must be different from institutional email." },
        { status: 400 }
      );
    }

    const existingOwner = await db.user.findUnique({
      where: { personalEmail },
      select: { id: true },
    });
    if (existingOwner && existingOwner.id !== user.id) {
      return NextResponse.json(
        { error: "Another account already uses this personal email." },
        { status: 409 }
      );
    }

    const rawToken = createRawToken();
    const expiresAt = createExpiryDate(1000 * 60 * 60 * 24);

    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: {
          personalEmail,
          personalEmailVerifiedAt: null,
          lastProfileCompletionPromptAt: new Date(),
        },
      }),
      db.emailVerificationToken.create({
        data: {
          userId: user.id,
          email: personalEmail,
          tokenHash: hashToken(rawToken),
          type: "PERSONAL_EMAIL_VERIFY",
          expiresAt,
        },
      }),
    ]);

    const verifyUrl = buildAppUrl(`/verify-email?token=${encodeURIComponent(rawToken)}`);
    const sent = await sendEmail({
      to: personalEmail,
      subject: "Verify your ATTENDANCE IQ personal email",
      html: verificationEmailHtml({
        recipientName: user.name ?? "there",
        verifyUrl,
        expiresAt,
        context: "profile",
      }),
      text: `Verify your personal email: ${verifyUrl}`,
    });

    if (!sent) {
      return NextResponse.json(
        { error: "Personal email updated, but verification email could not be sent." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Personal email updated. Check your inbox for verification.",
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Student profile update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
