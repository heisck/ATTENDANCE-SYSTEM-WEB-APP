import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";

function getDeadlineMeta(dueAt: Date, now: Date) {
  const ms = dueAt.getTime() - now.getTime();
  const minutes = Math.max(Math.ceil(ms / 60_000), 0);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return { minutes, hours, days };
}

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
    return NextResponse.json({ deadlines: [] });
  }
  if (!context.featureFlags.studentHubCore) {
    return NextResponse.json({ error: "Student hub is disabled" }, { status: 404 });
  }

  const scopeFilters: Array<Record<string, any>> = [];
  if (context.cohortId) {
    scopeFilters.push({ cohortId: context.cohortId });
  }
  if (context.enrolledCourseIds.length > 0) {
    scopeFilters.push({ courseId: { in: context.enrolledCourseIds } });
  }

  if (scopeFilters.length === 0) {
    return NextResponse.json({ deadlines: [] });
  }

  const now = new Date();
  const assignments = await db.assignmentAnnouncement.findMany({
    where: {
      organizationId: context.organizationId,
      OR: scopeFilters,
      dueAt: {
        gte: now,
      },
    },
    include: {
      course: {
        select: { id: true, code: true, name: true },
      },
      cohort: {
        select: { id: true, displayName: true },
      },
    },
    orderBy: { dueAt: "asc" },
    take: 20,
  });

  const deadlines = assignments.map((assignment) => ({
    id: assignment.id,
    title: assignment.title,
    dueAt: assignment.dueAt.toISOString(),
    course: assignment.course,
    cohort: assignment.cohort,
    ...getDeadlineMeta(assignment.dueAt, now),
  }));

  return NextResponse.json({
    deadlines,
    nextDueAt: deadlines[0]?.dueAt ?? null,
    now: now.toISOString(),
  });
}

