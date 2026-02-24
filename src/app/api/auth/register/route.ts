import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { registerSchema } from "@/lib/validators";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";
import { buildAppUrl, sendEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = registerSchema.parse(body);

    const institutionalEmail = parsed.institutionalEmail.trim().toLowerCase();
    const personalEmail = parsed.personalEmail.trim().toLowerCase();
    const normalizedStudentId = parsed.studentId.trim();
    const normalizedIndexNumber = parsed.indexNumber.trim();
    const organizationSlug = parsed.organizationSlug.trim().toLowerCase();

    const existingUser = await db.user.findUnique({
      where: { email: institutionalEmail },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this institutional email already exists" },
        { status: 409 }
      );
    }

    const existingByPersonalEmail = await db.user.findUnique({
      where: { personalEmail },
    });
    if (existingByPersonalEmail) {
      return NextResponse.json(
        { error: "An account with this personal email already exists" },
        { status: 409 }
      );
    }

    if (normalizedStudentId) {
      const existingByStudentId = await db.user.findUnique({
        where: { studentId: normalizedStudentId },
      });
      if (existingByStudentId) {
        return NextResponse.json(
          { error: "An account with this Student ID already exists" },
          { status: 409 }
        );
      }
    }

    if (normalizedIndexNumber) {
      const existingByIndexNumber = await db.user.findUnique({
        where: { indexNumber: normalizedIndexNumber },
      });
      if (existingByIndexNumber) {
        return NextResponse.json(
          { error: "An account with this Index Number already exists" },
          { status: 409 }
        );
      }
    }

    const org = await db.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json(
        { error: "University not found. Check the organization code." },
        { status: 404 }
      );
    }

    const passwordHash = await hash(parsed.password, 10);

    const createdUser = await db.user.create({
      data: {
        name: parsed.name,
        email: institutionalEmail,
        personalEmail,
        passwordHash,
        role: Role.STUDENT,
        studentId: normalizedStudentId,
        indexNumber: normalizedIndexNumber,
        organizationId: org.id,
      },
      select: {
        id: true,
        email: true,
        personalEmail: true,
        name: true,
        role: true,
      },
    });

    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = createExpiryDate(1000 * 60 * 60 * 24); // 24h

    await db.emailVerificationToken.create({
      data: {
        userId: createdUser.id,
        email: personalEmail,
        tokenHash,
        type: "PERSONAL_EMAIL_VERIFY",
        expiresAt,
      },
    });

    const verifyUrl = buildAppUrl(`/verify-email?token=${encodeURIComponent(rawToken)}`);
    let emailSent = true;
    try {
      await sendEmail({
        to: personalEmail,
        subject: "Verify your AttendanceIQ personal email",
        html: `
          <p>Hello ${createdUser.name},</p>
          <p>Verify your personal email to activate attendance features:</p>
          <p><a href="${verifyUrl}">Verify personal email</a></p>
          <p>This link expires on ${expiresAt.toUTCString()}.</p>
        `,
        text: `Hello ${createdUser.name}, verify your personal email: ${verifyUrl}`,
      });
    } catch (emailError) {
      emailSent = false;
      console.error("Verification email error:", emailError);
    }

    return NextResponse.json(
      {
        ...createdUser,
        message: emailSent
          ? "Account created. Check your personal email for verification."
          : "Account created. Email sending failed; request a new verification link.",
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }
    if (error?.code === "P2002" && Array.isArray(error?.meta?.target)) {
      const fields = error.meta.target as string[];
      if (fields.includes("email")) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }
      if (fields.includes("personalEmail")) {
        return NextResponse.json(
          { error: "An account with this personal email already exists" },
          { status: 409 }
        );
      }
      if (fields.includes("studentId")) {
        return NextResponse.json(
          { error: "An account with this Student ID already exists" },
          { status: 409 }
        );
      }
      if (fields.includes("indexNumber")) {
        return NextResponse.json(
          { error: "An account with this Index Number already exists" },
          { status: 409 }
        );
      }
    }
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
