import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { createStudentGroupSchema } from "@/lib/validators";

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
      mode: "SELF_SELECT",
    },
    select: {
      id: true,
      cohortId: true,
      courseId: true,
      groupSize: true,
      leaderMode: true,
      startsAt: true,
      endsAt: true,
    },
  });
  if (!formation) {
    return NextResponse.json({ error: "Self-select session not found" }, { status: 404 });
  }

  if (formation.cohortId && formation.cohortId !== context.cohortId) {
    return NextResponse.json({ error: "Session is not targeted to your cohort" }, { status: 403 });
  }
  if (formation.courseId && !context.enrolledCourseIds.includes(formation.courseId)) {
    return NextResponse.json({ error: "Session is not targeted to your enrolled courses" }, { status: 403 });
  }

  const now = new Date();
  if (now < formation.startsAt || now > formation.endsAt) {
    return NextResponse.json({ error: "This group session is outside the active window." }, { status: 400 });
  }

  const existingMembership = await db.groupMembership.findFirst({
    where: {
      studentId: context.userId,
      group: { sessionId: formation.id },
    },
    select: { id: true },
  });
  if (existingMembership) {
    return NextResponse.json({ error: "You are already assigned to a group in this session" }, { status: 409 });
  }

  try {
    const body = await request.json();
    const parsed = createStudentGroupSchema.parse(body);

    const group = await db.studentGroup.create({
      data: {
        sessionId: formation.id,
        name: parsed.name.trim(),
        capacity: parsed.capacity ?? formation.groupSize,
        ...(formation.leaderMode !== "RANDOM" ? { leaderId: context.userId } : {}),
        memberships: {
          create: {
            studentId: context.userId,
          },
        },
      },
      include: {
        _count: { select: { memberships: true } },
      },
    });

    return NextResponse.json({ group }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Create self-select group error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

