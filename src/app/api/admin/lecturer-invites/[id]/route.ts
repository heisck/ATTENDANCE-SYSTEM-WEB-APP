import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { lecturerInviteEmailHtml } from "@/lib/email-templates";
import { createRawToken, hashToken } from "@/lib/tokens";

function resolveOrganizationIdForStaff(
  user: { role?: string; organizationId?: string | null },
  requestedOrgId?: string | null
): string | null {
  if (user.role === "ADMIN") return user.organizationId || null;
  if (user.role === "SUPER_ADMIN") return requestedOrgId || user.organizationId || null;
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const action = body?.action as string | undefined;
    if (!action || !["resend", "revoke"].includes(action)) {
      return NextResponse.json({ error: "Action must be resend or revoke" }, { status: 400 });
    }

    const requestedOrgId = body?.organizationId ?? null;
    const organizationId = resolveOrganizationIdForStaff(user, requestedOrgId);
    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }

    const invite = await db.lecturerInvite.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    if (!invite || invite.organizationId !== organizationId) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    if (action === "revoke") {
      const revoked = await db.lecturerInvite.update({
        where: { id: invite.id },
        data: { revokedAt: new Date() },
      });
      return NextResponse.json({ invite: revoked });
    }

    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const [newInvite] = await db.$transaction([
      db.lecturerInvite.create({
        data: {
          organizationId: invite.organizationId,
          invitedEmail: invite.invitedEmail,
          tokenHash,
          invitedByUserId: user.id,
          expiresAt,
        },
      }),
      db.lecturerInvite.update({
        where: { id: invite.id },
        data: { revokedAt: new Date() },
      }),
    ]);

    const acceptUrl = buildAppUrl(`/accept-invite?token=${encodeURIComponent(rawToken)}`);
    await sendEmail({
      to: invite.invitedEmail,
      subject: `Updated lecturer invite for ${invite.organization.name}`,
      html: lecturerInviteEmailHtml({
        organizationName: invite.organization.name,
        acceptUrl,
        expiresAt,
        isResend: true,
      }),
      text: `Accept your lecturer invite: ${acceptUrl}`,
    });

    return NextResponse.json({ invite: newInvite, inviteUrl: acceptUrl });
  } catch (error: any) {
    console.error("Lecturer invite action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
