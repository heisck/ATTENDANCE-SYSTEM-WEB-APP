import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  buildStudentSignupLink,
  clearStudentSignupWindow,
  createStudentSignupWindow,
  getActiveStudentSignupWindow,
  withStudentSignupWindow,
} from "@/lib/student-signup-window";

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; role: string; organizationId?: string | null };
  if (!["LECTURER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!user.organizationId) {
    return NextResponse.json({ error: "Organization is required." }, { status: 400 });
  }

  const organization = await db.organization.findUnique({
    where: { id: user.organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      settings: true,
    },
  });

  if (!organization) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const activeWindow = getActiveStudentSignupWindow(organization.settings);
  return NextResponse.json({
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    signupWindow: activeWindow
      ? {
          expiresAt: activeWindow.expiresAt,
          department: activeWindow.department,
          level: activeWindow.level,
          groupCode: activeWindow.groupCode,
          requireGroup: activeWindow.requireGroup,
        }
      : null,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; role: string; organizationId?: string | null };
  if (!["LECTURER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!user.organizationId) {
    return NextResponse.json({ error: "Organization is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const ttlMinutes = Math.trunc(Number(body.ttlMinutes));
  if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 180) {
    return NextResponse.json(
      { error: "ttlMinutes must be between 1 and 180." },
      { status: 400 }
    );
  }

  const organization = await db.organization.findUnique({
    where: { id: user.organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      settings: true,
    },
  });

  if (!organization) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const { rawToken, window } = createStudentSignupWindow({
    ttlMinutes,
    department: normalizeOptionalText(body.department),
    level: Number(body.level),
    groupCode: normalizeOptionalText(body.groupCode),
    requireGroup: body.requireGroup === true,
    createdByUserId: user.id,
  });

  const settings = withStudentSignupWindow(organization.settings, window);
  await db.organization.update({
    where: { id: organization.id },
    data: { settings },
  });

  return NextResponse.json(
    {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
      signupWindow: {
        expiresAt: window.expiresAt,
        department: window.department,
        level: window.level,
        groupCode: window.groupCode,
        requireGroup: window.requireGroup,
      },
      inviteUrl: buildStudentSignupLink({
        organizationSlug: organization.slug,
        rawToken,
      }),
    },
    { status: 201 }
  );
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { role: string; organizationId?: string | null };
  if (!["LECTURER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!user.organizationId) {
    return NextResponse.json({ error: "Organization is required." }, { status: 400 });
  }

  const organization = await db.organization.findUnique({
    where: { id: user.organizationId },
    select: {
      id: true,
      settings: true,
    },
  });

  if (!organization) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  await db.organization.update({
    where: { id: organization.id },
    data: {
      settings: clearStudentSignupWindow(organization.settings),
    },
  });

  return NextResponse.json({ success: true });
}
