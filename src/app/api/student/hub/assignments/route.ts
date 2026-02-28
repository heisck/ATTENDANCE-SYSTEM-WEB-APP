import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!context.organizationId) {
    return NextResponse.json({ assignments: [], status: "upcoming" });
  }
  if (!context.featureFlags.studentHubCore) {
    return NextResponse.json({ error: "Student hub is disabled" }, { status: 404 });
  }

  const search = new URL(request.url).searchParams;
  const status = search.get("status") === "all" ? "all" : "upcoming";
  const limitRaw = Number(search.get("limit") || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 100;

  const scopeFilters: Array<Record<string, any>> = [];
  if (context.cohortId) {
    scopeFilters.push({ cohortId: context.cohortId });
  }
  if (context.enrolledCourseIds.length > 0) {
    scopeFilters.push({ courseId: { in: context.enrolledCourseIds } });
  }

  if (scopeFilters.length === 0) {
    return NextResponse.json({ assignments: [], status });
  }

  const now = new Date();
  const assignments = await db.assignmentAnnouncement.findMany({
    where: {
      organizationId: context.organizationId,
      OR: scopeFilters,
      ...(status === "upcoming" ? { dueAt: { gte: now } } : {}),
    },
    include: {
      cohort: {
        select: { id: true, displayName: true, department: true, level: true, groupCode: true },
      },
      course: {
        select: { id: true, code: true, name: true },
      },
      attachments: true,
    },
    orderBy: status === "upcoming" ? { dueAt: "asc" } : { dueAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ assignments, status, now: now.toISOString() });
}

