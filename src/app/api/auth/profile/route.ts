import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { verificationEmailHtml } from "@/lib/email-templates";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";

const updateProfileSchema = z
  .object({
    email: z.string().email("Invalid sign-in email").optional(),
    personalEmail: z.string().email("Invalid personal email").optional(),
    currentPassword: z.string().min(1, "Current password is required").optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.email && !data.personalEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Provide at least one field to update.",
      });
    }

    if (data.email && !data.currentPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentPassword"],
        message: "Current password is required to update sign-in email.",
      });
    }
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
      organization: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = updateProfileSchema.parse(body);
    const nextSignInEmail = parsed.email?.trim().toLowerCase();
    const nextPersonalEmail = parsed.personalEmail?.trim().toLowerCase();

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true, personalEmail: true, passwordHash: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (nextSignInEmail && session.user.role === "STUDENT") {
      return NextResponse.json(
        { error: "Students cannot update institutional sign-in email from this endpoint." },
        { status: 403 }
      );
    }

    const currentSignInEmail = user.email.toLowerCase();
    const resolvedSignInEmail = nextSignInEmail || currentSignInEmail;
    const currentPersonalEmail = (user.personalEmail || "").toLowerCase();

    if (nextPersonalEmail && nextPersonalEmail === resolvedSignInEmail) {
      return NextResponse.json(
        { error: "Personal email must be different from sign-in email." },
        { status: 400 }
      );
    }

    const updateData: {
      email?: string;
      personalEmail?: string;
      personalEmailVerifiedAt?: Date | null;
    } = {};

    let signInEmailChanged = false;
    let personalEmailChanged = false;

    if (nextSignInEmail && nextSignInEmail !== currentSignInEmail) {
      const passwordMatches = await compare(parsed.currentPassword || "", user.passwordHash);
      if (!passwordMatches) {
        return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
      }

      const existingUser = await db.user.findUnique({
        where: { email: nextSignInEmail },
        select: { id: true },
      });
      if (existingUser && existingUser.id !== user.id) {
        return NextResponse.json(
          { error: "Another account already uses this sign-in email." },
          { status: 409 }
        );
      }

      updateData.email = nextSignInEmail;
      signInEmailChanged = true;
    }

    if (nextPersonalEmail && nextPersonalEmail !== currentPersonalEmail) {
      const existingOwner = await db.user.findUnique({
        where: { personalEmail: nextPersonalEmail },
        select: { id: true },
      });
      if (existingOwner && existingOwner.id !== user.id) {
        return NextResponse.json(
          { error: "Another account already uses this personal email." },
          { status: 409 }
        );
      }

      updateData.personalEmail = nextPersonalEmail;
      updateData.personalEmailVerifiedAt = null;
      personalEmailChanged = true;
    }

    if (!signInEmailChanged && !personalEmailChanged) {
      return NextResponse.json({
        success: true,
        message: "No changes detected.",
      });
    }

    let rawToken: string | null = null;
    let expiresAt: Date | null = null;

    if (personalEmailChanged) {
      rawToken = createRawToken();
      expiresAt = createExpiryDate(1000 * 60 * 60 * 24);
    }

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: updateData,
      });

      if (personalEmailChanged && rawToken && expiresAt && updateData.personalEmail) {
        await tx.emailVerificationToken.create({
          data: {
            userId: user.id,
            email: updateData.personalEmail,
            tokenHash: hashToken(rawToken),
            type: "PERSONAL_EMAIL_VERIFY",
            expiresAt,
          },
        });
      }
    });

    if (personalEmailChanged && rawToken && expiresAt && updateData.personalEmail) {
      const verifyUrl = buildAppUrl(`/verify-email?token=${encodeURIComponent(rawToken)}`);
      const sent = await sendEmail({
        to: updateData.personalEmail,
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
          { error: "Email updated, but verification email could not be sent." },
          { status: 503 }
        );
      }
    }

    if (signInEmailChanged && personalEmailChanged) {
      return NextResponse.json({
        success: true,
        message: "Sign-in email and personal email updated. Verify your personal email from inbox.",
      });
    }

    if (signInEmailChanged) {
      return NextResponse.json({
        success: true,
        message: "Sign-in email updated successfully.",
      });
    }

    return NextResponse.json({
      success: true,
      message: "Personal email updated. Check your inbox for verification.",
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request payload." },
        { status: 400 }
      );
    }
    console.error("Profile update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
