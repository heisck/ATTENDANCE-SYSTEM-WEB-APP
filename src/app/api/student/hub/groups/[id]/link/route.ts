import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { groupLinkSchema } from "@/lib/validators";
import { enqueueManyJobs } from "@/lib/job-queue";

async function resolveMemberGroupContext(groupId: string, userId: string, organizationId: string) {
  const group = await db.studentGroup.findUnique({
    where: { id: groupId },
    include: {
      session: {
        select: {
          organizationId: true,
          active: true,
        },
      },
      memberships: {
        select: {
          studentId: true,
        },
      },
    },
  });

  if (!group || group.session.organizationId !== organizationId) {
    return null;
  }

  const isMember = group.memberships.some((row) => row.studentId === userId);
  if (!isMember) return null;

  return group;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!context.organizationId) {
    return NextResponse.json({ error: "No organization context" }, { status: 400 });
  }
  if (!context.featureFlags.studentHubCore || !context.featureFlags.groupFormation) {
    return NextResponse.json({ error: "groupFormation feature is disabled" }, { status: 404 });
  }

  const { id } = await params;
  const group = await resolveMemberGroupContext(id, context.userId, context.organizationId);
  if (!group) {
    return NextResponse.json({ error: "Group not found or access denied" }, { status: 404 });
  }

  const link = await db.groupLink.findUnique({
    where: { groupId: group.id },
  });

  return NextResponse.json({ link });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!context.organizationId) {
    return NextResponse.json({ error: "No organization context" }, { status: 400 });
  }
  if (!context.featureFlags.studentHubCore || !context.featureFlags.groupFormation) {
    return NextResponse.json({ error: "groupFormation feature is disabled" }, { status: 404 });
  }

  const { id } = await params;
  const group = await resolveMemberGroupContext(id, context.userId, context.organizationId);
  if (!group) {
    return NextResponse.json({ error: "Group not found or access denied" }, { status: 404 });
  }

  if (group.leaderId && group.leaderId !== context.userId) {
    return NextResponse.json({ error: "Only the group leader can publish the link." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = groupLinkSchema.parse(body);

    const link = await db.groupLink.upsert({
      where: { groupId: group.id },
      update: {
        inviteUrl: parsed.inviteUrl,
        postedByStudentId: context.userId,
      },
      create: {
        groupId: group.id,
        inviteUrl: parsed.inviteUrl,
        postedByStudentId: context.userId,
      },
    });

    const memberIds = group.memberships.map((row) => row.studentId).filter((id) => id !== context.userId);
    await enqueueManyJobs(
      memberIds.map((userId) => ({
        type: JobType.SEND_NOTIFICATION,
        payload: {
          userId,
          type: "SYSTEM",
          title: "Group link posted",
          body: "Your group leader has published the WhatsApp invite link.",
          metadata: {
            groupId: group.id,
            groupLinkId: link.id,
          },
        },
        organizationId: context.organizationId,
      }))
    );

    return NextResponse.json({ link });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Publish group link error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

