import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/passwords";
import { registerSchema } from "@/lib/validators";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { verificationEmailHtml } from "@/lib/email-templates";
import { getStudentEmailDomains } from "@/lib/organization-settings";
import { validateStudentSignupToken } from "@/lib/student-signup-window";
import { checkRateLimitKey } from "@/lib/cache";

const REGISTER_IP_MAX_ATTEMPTS = 5;
const REGISTER_WINDOW_SECONDS = 15 * 60;

function getClientIp(request: NextRequest): string {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "";
  if (!ip) {
    console.warn("[register] Could not resolve client IP from request headers");
  }
  return ip || "unknown";
}

const UNKNOWN_IP_MAX_ATTEMPTS = 2;

export async function POST(request: NextRequest) {
  try {
    // Rate limit registration by IP
    const clientIp = getClientIp(request);
    const ipLimit = clientIp === "unknown" ? UNKNOWN_IP_MAX_ATTEMPTS : REGISTER_IP_MAX_ATTEMPTS;
    try {
      const { allowed } = await checkRateLimitKey(
        `register-ratelimit:ip:${clientIp}`,
        ipLimit,
        REGISTER_WINDOW_SECONDS
      );
      if (!allowed) {
        return NextResponse.json(
          { error: "Too many registration attempts. Please try again later." },
          { status: 429 }
        );
      }
    } catch (err) {
      console.error("[register] IP rate limit check failed:", err);
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: "Service temporarily unavailable. Please try again." },
          { status: 503 }
        );
      }
    }

    const body = await request.json();
    const parsed = registerSchema.parse(body);

    const institutionalEmail = parsed.institutionalEmail.trim().toLowerCase();
    const personalEmail = parsed.personalEmail.trim().toLowerCase();
    const signupToken = parsed.signupToken.trim();
    const normalizedStudentId = parsed.studentId.trim();
    const normalizedIndexNumber = parsed.indexNumber.trim();
    const organizationSlug = parsed.organizationSlug.trim().toLowerCase();
    const fullName = [
      parsed.firstName.trim(),
      parsed.otherNames?.trim() || "",
      parsed.lastName.trim(),
    ]
      .filter((value) => value.length > 0)
      .join(" ");

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
      select: {
        id: true,
        domain: true,
        settings: true,
      },
    });
    if (!org) {
      return NextResponse.json(
        { error: "University not found. Check the organization code." },
        { status: 404 }
      );
    }

    const signupWindow = validateStudentSignupToken(org.settings, signupToken);
    if (!signupWindow) {
      return NextResponse.json(
        { error: "Student signup is closed or this invite link is invalid." },
        { status: 403 }
      );
    }

    const department = signupWindow.department ?? parsed.department.trim().toUpperCase();
    const level = signupWindow.level ?? parsed.level;
    const groupCode = signupWindow.groupCode ?? parsed.groupCode.trim().toUpperCase();
    const normalizedGroupCode = groupCode.length > 0 ? groupCode : "GENERAL";

    if (signupWindow.requireGroup && normalizedGroupCode === "GENERAL") {
      return NextResponse.json(
        { error: "This signup window requires a group." },
        { status: 400 }
      );
    }

    const allowedDomains = getStudentEmailDomains(org.settings, org.domain);
    const institutionalDomain = institutionalEmail.split("@")[1] || "";
    if (allowedDomains.length > 0 && !allowedDomains.includes(institutionalDomain)) {
      return NextResponse.json(
        { error: `Institutional email domain must be one of: ${allowedDomains.join(", ")}` },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(parsed.password);

    const cohort = await db.cohort.upsert({
      where: {
        organizationId_department_level_groupCode: {
            organizationId: org.id,
            department,
            level,
            groupCode: normalizedGroupCode,
        },
      },
      update: {
        displayName:
          normalizedGroupCode === "GENERAL"
            ? `${department} ${level}`
            : `${department} ${level} ${normalizedGroupCode}`,
      },
      create: {
        organizationId: org.id,
        department,
        level,
        groupCode: normalizedGroupCode,
        displayName:
          normalizedGroupCode === "GENERAL"
            ? `${department} ${level}`
            : `${department} ${level} ${normalizedGroupCode}`,
      },
      select: { id: true },
    });

    const createdUser = await db.user.create({
      data: {
        name: fullName,
        email: institutionalEmail,
        personalEmail,
        passwordHash,
        role: Role.STUDENT,
        studentId: normalizedStudentId,
        indexNumber: normalizedIndexNumber,
        organizationId: org.id,
        cohortId: cohort.id,
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
      emailSent = await sendEmail({
        to: personalEmail,
        subject: "Verify your ATTENDANCE IQ personal email",
        html: verificationEmailHtml({
          recipientName: createdUser.name,
          verifyUrl,
          expiresAt,
          context: "register",
        }),
        text: `Hello ${createdUser.name}, verify your personal email: ${verifyUrl}`,
      });
    } catch (emailError) {
      emailSent = false;
      console.error("Verification email error:", emailError);
    }

    return NextResponse.json(
      {
        ...createdUser,
        emailSent,
        message: emailSent
          ? "Account created. Check your personal email for verification."
          : "Account created. Email sending failed; request a new verification link.",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const err = error as any;
    if (err?.name === "ZodError") {
      return NextResponse.json(
        {
          error:
            err?.issues?.[0]?.message ||
            err?.errors?.[0]?.message ||
            "Invalid request payload.",
        },
        { status: 400 }
      );
    }
    if (err?.code === "P2002" && Array.isArray(err?.meta?.target)) {
      const fields = err.meta.target as string[];
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
    console.error("Registration error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
