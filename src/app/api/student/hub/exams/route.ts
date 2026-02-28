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
    return NextResponse.json({ exams: [] });
  }
  if (!context.featureFlags.studentHubCore || !context.featureFlags.examHub) {
    return NextResponse.json({ error: "examHub feature is disabled" }, { status: 404 });
  }

  const scopeFilters: Array<Record<string, any>> = [];
  if (context.cohortId) {
    scopeFilters.push({ cohortId: context.cohortId });
  }
  if (context.enrolledCourseIds.length > 0) {
    scopeFilters.push({ courseId: { in: context.enrolledCourseIds } });
  }

  if (scopeFilters.length === 0) {
    return NextResponse.json({ exams: [] });
  }

  const now = new Date();
  const exams = await db.examEntry.findMany({
    where: {
      organizationId: context.organizationId,
      OR: scopeFilters,
      examDate: {
        gte: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30),
      },
    },
    include: {
      course: {
        select: { id: true, code: true, name: true },
      },
      cohort: {
        select: { id: true, displayName: true, department: true, level: true, groupCode: true },
      },
      attachments: true,
      updates: {
        orderBy: { effectiveAt: "desc" },
        take: 20,
      },
    },
    orderBy: { examDate: "asc" },
    take: 200,
  });

  return NextResponse.json({ exams, now: now.toISOString() });
}

