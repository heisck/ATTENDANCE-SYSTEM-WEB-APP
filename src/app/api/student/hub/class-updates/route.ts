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
    return NextResponse.json({ updates: [] });
  }
  if (!context.featureFlags.studentHubCore) {
    return NextResponse.json({ error: "Student hub is disabled" }, { status: 404 });
  }

  const search = new URL(request.url).searchParams;
  const limitRaw = Number(search.get("limit") || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

  const scopeFilters: Array<Record<string, any>> = [];
  if (context.cohortId) {
    scopeFilters.push({ cohortId: context.cohortId });
  }
  if (context.enrolledCourseIds.length > 0) {
    scopeFilters.push({ courseId: { in: context.enrolledCourseIds } });
  }
  scopeFilters.push({
    AND: [{ cohortId: null }, { courseId: null }],
  });

  const updates = await db.classUpdate.findMany({
    where: {
      organizationId: context.organizationId,
      isActive: true,
      OR: scopeFilters,
    },
    include: {
      cohort: {
        select: { id: true, displayName: true, department: true, level: true, groupCode: true },
      },
      course: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json({ updates });
}

