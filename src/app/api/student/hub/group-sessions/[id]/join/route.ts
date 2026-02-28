import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { joinGroupSchema } from "@/lib/validators";

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

  const { id: sessionId } = await params;
  const formation = await db.groupFormationSession.findFirst({
    where: {
      id: sessionId,
      organizationId: context.organizationId,
      active: true,
    },
    select: {
      id: true,
      cohortId: true,
      courseId: true,
      startsAt: true,
      endsAt: true,
      leaderMode: true,
    },
  });

  if (!formation) {
    return NextResponse.json({ error: "Group session not found" }, { status: 404 });
  }

  if (formation.cohortId && formation.cohortId !== context.cohortId) {
    return NextResponse.json({ error: "Session is not targeted to your cohort" }, { status: 403 });
  }
  if (formation.courseId && !context.enrolledCourseIds.includes(formation.courseId)) {
    return NextResponse.json({ error: "Session is not targeted to your enrolled courses" }, { status: 403 });
  }

  const now = new Date();
  if (now < formation.startsAt || now > formation.endsAt) {
    return NextResponse.json({ error: "This group session is outside the active join window." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const parsed = joinGroupSchema.parse(body);

    const [group, existingMembership] = await Promise.all([
      db.studentGroup.findFirst({
        where: {
          id: parsed.groupId,
          sessionId: formation.id,
        },
        include: {
          _count: { select: { memberships: true } },
        },
      }),
      db.groupMembership.findFirst({
        where: {
          studentId: context.userId,
          group: { sessionId: formation.id },
        },
      }),
    ]);

    if (!group) {
      return NextResponse.json({ error: "Selected group not found in this session" }, { status: 404 });
    }
    if (existingMembership) {
      return NextResponse.json({ error: "You are already assigned to a group in this session" }, { status: 409 });
    }
    if (group._count.memberships >= group.capacity) {
      return NextResponse.json({ error: "This group is already full" }, { status: 400 });
    }

    const membership = await db.groupMembership.create({
      data: {
        groupId: group.id,
        studentId: context.userId,
      },
    });

    if (formation.leaderMode === "VOLUNTEER_FIRST_COME") {
      const groupState = await db.studentGroup.findUnique({
        where: { id: group.id },
        select: { leaderId: true },
      });
      if (!groupState?.leaderId) {
        await db.studentGroup.update({
          where: { id: group.id },
          data: { leaderId: context.userId },
        });
      }
    }

    return NextResponse.json({ membership }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Join group session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

