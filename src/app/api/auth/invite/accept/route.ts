import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { acceptLecturerInviteSchema } from "@/lib/validators";
import { hashToken } from "@/lib/tokens";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = acceptLecturerInviteSchema.parse(body);

    const tokenHash = hashToken(parsed.token.trim());
    const now = new Date();
    const invite = await db.lecturerInvite.findUnique({
      where: { tokenHash },
      include: {
        organization: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!invite || !invite.organization) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    if (invite.revokedAt || invite.acceptedAt || invite.expiresAt < now) {
      return NextResponse.json({ error: "Invite is invalid or expired" }, { status: 400 });
    }

    const existingUser = await db.user.findUnique({
      where: { email: invite.invitedEmail },
      select: { id: true },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "This email already has an account. Contact your admin." },
        { status: 409 }
      );
    }

    const passwordHash = await hash(parsed.password, 10);
    const createdUser = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invite.invitedEmail,
          name: parsed.name.trim(),
          passwordHash,
          role: Role.LECTURER,
          organizationId: invite.organizationId,
        },
        select: {
          id: true,
          email: true,
          role: true,
          organizationId: true,
        },
      });

      await tx.lecturerInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: now },
      });

      return user;
    });

    return NextResponse.json({ success: true, user: createdUser }, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Accept invite error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
