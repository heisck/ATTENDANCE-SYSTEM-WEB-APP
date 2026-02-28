import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!context.organizationId) {
    return NextResponse.json({ sessions: [] });
  }
  if (!context.featureFlags.studentHubCore || !context.featureFlags.groupFormation) {
    return NextResponse.json({ error: "groupFormation feature is disabled" }, { status: 404 });
  }

  const scopeFilters: Array<Record<string, any>> = [];
  if (context.cohortId) {
    scopeFilters.push({ cohortId: context.cohortId });
  }
  if (context.enrolledCourseIds.length > 0) {
    scopeFilters.push({ courseId: { in: context.enrolledCourseIds } });
  }
  if (scopeFilters.length === 0) {
    return NextResponse.json({ sessions: [] });
  }

  const now = new Date();
  const sessions = await db.groupFormationSession.findMany({
    where: {
      organizationId: context.organizationId,
      OR: scopeFilters,
      active: true,
      endsAt: {
        gte: new Date(now.getTime() - 1000 * 60 * 60 * 24),
      },
    },
    include: {
      cohort: { select: { id: true, displayName: true } },
      course: { select: { id: true, code: true, name: true } },
      groups: {
        include: {
          _count: { select: { memberships: true } },
          link: true,
          memberships: {
            where: { studentId: context.userId },
            select: { studentId: true, groupId: true },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { startsAt: "desc" },
    take: 100,
  });

  const ownMemberships = await db.groupMembership.findMany({
    where: {
      studentId: context.userId,
      group: {
        session: {
          organizationId: context.organizationId,
        },
      },
    },
    select: {
      id: true,
      groupId: true,
      group: {
        select: {
          id: true,
          name: true,
          sessionId: true,
        },
      },
    },
  });

  return NextResponse.json({
    sessions,
    memberships: ownMemberships,
    now: now.toISOString(),
  });
}

