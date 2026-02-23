import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Invite token is required" }, { status: 400 });
  }

  const invite = await db.lecturerInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
    },
  });

  if (
    !invite ||
    invite.revokedAt ||
    invite.acceptedAt ||
    invite.expiresAt < new Date()
  ) {
    return NextResponse.json({ error: "Invite is invalid or expired" }, { status: 400 });
  }

  return NextResponse.json({
    invitedEmail: invite.invitedEmail,
    expiresAt: invite.expiresAt,
    organization: invite.organization,
  });
}
