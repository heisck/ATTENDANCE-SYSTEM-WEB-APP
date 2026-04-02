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

    const membership = await db.$transaction(
      async (tx) => {
        const existingMembership = await tx.groupMembership.findUnique({
          where: {
            sessionId_studentId: {
              sessionId: formation.id,
              studentId: context.userId,
            },
          },
        });

        if (existingMembership) {
          throw new Error("You are already assigned to a group in this session");
        }

        const group = await tx.studentGroup.findFirst({
          where: {
            id: parsed.groupId,
            sessionId: formation.id,
          },
          include: {
            _count: { select: { memberships: true } },
          },
        });

        if (!group) {
          throw new Error("Selected group not found in this session");
        }

        if (group._count.memberships >= group.capacity) {
          throw new Error("This group is already full");
        }

        const newMembership = await tx.groupMembership.create({
          data: {
            groupId: group.id,
            studentId: context.userId,
            sessionId: formation.id,
          },
        });

        if (formation.leaderMode === "VOLUNTEER_FIRST_COME") {
          if (!group.leaderId) {
            await tx.studentGroup.update({
              where: { id: group.id },
              data: { leaderId: context.userId },
            });
          }
        }

        return newMembership;
      },
      { isolationLevel: "Serializable" }
    );

    return NextResponse.json({ membership }, { status: 201 });
  } catch (error: any) {
    if (error?.message === "You are already assigned to a group in this session") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error?.message === "Selected group not found in this session") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error?.message === "This group is already full") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
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

