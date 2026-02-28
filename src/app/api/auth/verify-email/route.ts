import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Verification token is required" }, { status: 400 });
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  const verification = await db.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          organizationId: true,
          personalEmail: true,
        },
      },
    },
  });

  if (
    !verification ||
    verification.usedAt ||
    verification.expiresAt < now ||
    verification.type !== "PERSONAL_EMAIL_VERIFY"
  ) {
    return NextResponse.json({ error: "Verification link is invalid or expired" }, { status: 400 });
  }

  if (!verification.user || verification.user.personalEmail !== verification.email) {
    return NextResponse.json(
      { error: "Verification link does not match your current personal email" },
      { status: 400 }
    );
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: verification.userId },
      data: { personalEmailVerifiedAt: now },
    });

    await tx.emailVerificationToken.update({
      where: { id: verification.id },
      data: { usedAt: now },
    });

    if (verification.user?.organizationId) {
      const pendingInvites = await tx.courseRepInvite.findMany({
        where: {
          organizationId: verification.user.organizationId,
          invitedEmail: verification.user.email.toLowerCase(),
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          cohortId: true,
          courseId: true,
          invitedByUserId: true,
          organizationId: true,
        },
      });

      for (const invite of pendingInvites) {
        if (!invite.cohortId && !invite.courseId) {
          continue;
        }

        const existingScope = await tx.courseRepScope.findFirst({
          where: {
            userId: verification.userId,
            organizationId: invite.organizationId,
            cohortId: invite.cohortId,
            courseId: invite.courseId,
          },
          select: { id: true },
        });

        if (existingScope) {
          await tx.courseRepScope.update({
            where: { id: existingScope.id },
            data: {
              active: true,
              assignedByUserId: invite.invitedByUserId,
            },
          });
        } else {
          await tx.courseRepScope.create({
            data: {
              userId: verification.userId,
              organizationId: invite.organizationId,
              cohortId: invite.cohortId,
              courseId: invite.courseId,
              active: true,
              assignedByUserId: invite.invitedByUserId,
            },
          });
        }

        await tx.courseRepInvite.update({
          where: { id: invite.id },
          data: {
            acceptedAt: now,
            targetUserId: verification.userId,
          },
        });
      }
    }
  });

  return NextResponse.json({ success: true });
}
