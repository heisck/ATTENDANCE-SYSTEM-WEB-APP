import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { courseRepInviteEmailHtml } from "@/lib/email-templates";
import { createRawToken, hashToken } from "@/lib/tokens";
import { isAdminLike, resolveOrganizationIdForStaff } from "@/lib/permissions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!isAdminLike(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const action = body?.action as string | undefined;
    if (!action || !["resend", "revoke"].includes(action)) {
      return NextResponse.json({ error: "Action must be resend or revoke" }, { status: 400 });
    }

    const organizationId = resolveOrganizationIdForStaff(user, body?.organizationId ?? null);
    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }

    const invite = await db.courseRepInvite.findUnique({
      where: { id },
      include: { organization: { select: { id: true, name: true } } },
    });

    if (!invite || invite.organizationId !== organizationId) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    if (action === "revoke") {
      const revoked = await db.courseRepInvite.update({
        where: { id: invite.id },
        data: { revokedAt: new Date() },
      });
      return NextResponse.json({ invite: revoked });
    }

    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const [newInvite] = await db.$transaction([
      db.courseRepInvite.create({
        data: {
          organizationId: invite.organizationId,
          invitedEmail: invite.invitedEmail,
          targetUserId: invite.targetUserId,
          cohortId: invite.cohortId,
          courseId: invite.courseId,
          tokenHash,
          expiresAt,
          invitedByUserId: user.id,
        },
      }),
      db.courseRepInvite.update({
        where: { id: invite.id },
        data: { revokedAt: new Date() },
      }),
    ]);

    const acceptUrl = buildAppUrl(`/login?courseRepInvite=${encodeURIComponent(rawToken)}`);
    await sendEmail({
      to: invite.invitedEmail,
      subject: `Updated Course Rep invite for ${invite.organization.name}`,
      html: courseRepInviteEmailHtml({
        organizationName: invite.organization.name,
        acceptUrl,
        expiresAt,
        isResend: true,
      }),
      text: `Course rep invite link: ${acceptUrl}`,
    });

    return NextResponse.json({ invite: newInvite, inviteUrl: acceptUrl });
  } catch (error) {
    console.error("Course rep invite action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}