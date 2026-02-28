import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { courseRepInviteSchema } from "@/lib/validators";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { courseRepInviteEmailHtml } from "@/lib/email-templates";
import { createRawToken, hashToken } from "@/lib/tokens";
import { isAdminLike, resolveOrganizationIdForStaff } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!isAdminLike(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedOrgId = new URL(request.url).searchParams.get("organizationId");
  const organizationId = resolveOrganizationIdForStaff(user, requestedOrgId);
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const invites = await db.courseRepInvite.findMany({
    where: { organizationId },
    include: {
      targetUser: {
        select: { id: true, name: true, email: true },
      },
      cohort: {
        select: { id: true, displayName: true, department: true, level: true, groupCode: true },
      },
      course: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ invites });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!isAdminLike(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = courseRepInviteSchema.parse(body);
    const invitedEmail = parsed.invitedEmail.trim().toLowerCase();

    const organizationId = resolveOrganizationIdForStaff(user, body.organizationId);
    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }

    const [organization, targetUser, cohort, course] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true },
      }),
      db.user.findUnique({
        where: { email: invitedEmail },
        select: { id: true, role: true, organizationId: true },
      }),
      parsed.cohortId
        ? db.cohort.findFirst({
            where: { id: parsed.cohortId, organizationId },
            select: { id: true },
          })
        : Promise.resolve(null),
      parsed.courseId
        ? db.course.findFirst({
            where: { id: parsed.courseId, organizationId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (!organization) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    if (parsed.cohortId && !cohort) {
      return NextResponse.json({ error: "Cohort not found in organization" }, { status: 404 });
    }

    if (parsed.courseId && !course) {
      return NextResponse.json({ error: "Course not found in organization" }, { status: 404 });
    }

    if (targetUser && targetUser.organizationId !== organizationId) {
      return NextResponse.json({ error: "Target user belongs to another organization" }, { status: 409 });
    }

    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + parsed.ttlHours * 60 * 60 * 1000);

    const invite = await db.courseRepInvite.create({
      data: {
        organizationId,
        invitedEmail,
        targetUserId: targetUser?.id,
        cohortId: parsed.cohortId,
        courseId: parsed.courseId,
        tokenHash,
        expiresAt,
        invitedByUserId: user.id,
      },
    });

    const acceptUrl = buildAppUrl(`/login?courseRepInvite=${encodeURIComponent(rawToken)}`);
    await sendEmail({
      to: invitedEmail,
      subject: `Course Rep invite for ${organization.name}`,
      html: courseRepInviteEmailHtml({
        organizationName: organization.name,
        acceptUrl,
        expiresAt,
        isResend: false,
      }),
      text: `Course rep invite link: ${acceptUrl}`,
    });

    return NextResponse.json({ invite, inviteUrl: acceptUrl }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Course rep invite create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}