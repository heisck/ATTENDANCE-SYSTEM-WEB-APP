import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getActiveStudentSignupWindow,
  validateStudentSignupToken,
} from "@/lib/student-signup-window";

export async function GET(request: NextRequest) {
  const orgSlug = request.nextUrl.searchParams.get("org")?.trim().toLowerCase() || "";
  const token = request.nextUrl.searchParams.get("token")?.trim() || "";

  if (!orgSlug || !token) {
    return NextResponse.json(
      { error: "Organization and token are required." },
      { status: 400 }
    );
  }

  const organization = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      settings: true,
    },
  });

  if (!organization) {
    return NextResponse.json(
      { error: "Signup window not found." },
      { status: 404 }
    );
  }

  const activeWindow = getActiveStudentSignupWindow(organization.settings);
  if (!activeWindow) {
    return NextResponse.json(
      { error: "This signup window has expired or is unavailable." },
      { status: 410 }
    );
  }

  const validatedWindow = validateStudentSignupToken(organization.settings, token);
  if (!validatedWindow) {
    return NextResponse.json(
      { error: "Signup token is invalid or has expired." },
      { status: 403 }
    );
  }

  return NextResponse.json({
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    signupWindow: {
      expiresAt: validatedWindow.expiresAt,
      department: validatedWindow.department,
      level: validatedWindow.level,
      groupCode: validatedWindow.groupCode,
      requireGroup: validatedWindow.requireGroup,
    },
  });
}
