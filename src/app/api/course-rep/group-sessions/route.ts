import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike, resolveOrganizationIdForStaff } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";
import { resolveRepOrAdminWriteAccess } from "@/lib/phase2-access";
import { groupFormationSessionSchema } from "@/lib/validators";
import { enqueueManyJobs } from "@/lib/job-queue";

function buildScopeOrFilter(scopes: Array<{ cohortId: string | null; courseId: string | null }>) {
  if (scopes.some((scope) => !scope.cohortId && !scope.courseId)) {
    return undefined;
  }
  const filters = scopes.map((scope) => ({
    ...(scope.cohortId ? { cohortId: scope.cohortId } : {}),
    ...(scope.courseId ? { courseId: scope.courseId } : {}),
  }));
  return filters.length > 0 ? { OR: filters } : { OR: [{ id: "__no_match__" }] };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  const search = new URL(request.url).searchParams;

  if (isAdminLike(user.role)) {
    const organizationId = resolveOrganizationIdForStaff(user, search.get("organizationId"));
    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!organization) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const flags = getFeatureFlags(organization.settings);
    if (!flags.studentHubCore || !flags.groupFormation) {
      return NextResponse.json({ error: "groupFormation feature is disabled" }, { status: 403 });
    }

    const sessions = await db.groupFormationSession.findMany({
      where: {
        organizationId,
      },
      include: {
        cohort: { select: { id: true, displayName: true, department: true, level: true, groupCode: true } },
        course: { select: { id: true, code: true, name: true } },
        groups: {
          include: {
            _count: { select: { memberships: true } },
            link: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { startsAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ sessions });
  }

  const rep = await getStudentRepContext(session.user.id);
  if (!rep || !rep.isCourseRep || !rep.user.organizationId) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }
  if (!rep.featureFlags.studentHubCore || !rep.featureFlags.groupFormation) {
    return NextResponse.json({ error: "groupFormation feature is disabled" }, { status: 403 });
  }

  const scopedFilter = buildScopeOrFilter(rep.scopes);
  const sessions = await db.groupFormationSession.findMany({
    where: {
      organizationId: rep.user.organizationId,
      ...(scopedFilter || {}),
    },
    include: {
      cohort: { select: { id: true, displayName: true, department: true, level: true, groupCode: true } },
      course: { select: { id: true, code: true, name: true } },
      groups: {
        include: {
          _count: { select: { memberships: true } },
          link: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { startsAt: "desc" },
    take: 200,
  });

  const filtered = sessions.filter((item) =>
    hasMatchingScope(rep.scopes, { cohortId: item.cohortId, courseId: item.courseId })
  );

  return NextResponse.json({ sessions: filtered });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = groupFormationSessionSchema.parse(body);

    const startsAt = new Date(parsed.startsAt);
    const endsAt = new Date(parsed.endsAt);
    if (startsAt >= endsAt) {
      return NextResponse.json({ error: "endsAt must be later than startsAt." }, { status: 400 });
    }

    const access = await resolveRepOrAdminWriteAccess({
      sessionUser: {
        id: session.user.id,
        role: session.user.role,
        organizationId: (session.user as any).organizationId ?? null,
      },
      requestedOrganizationId: body?.organizationId ?? null,
      cohortId: parsed.cohortId ?? null,
      courseId: parsed.courseId ?? null,
      requiredFlag: "groupFormation",
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const [cohort, course] = await Promise.all([
      parsed.cohortId
        ? db.cohort.findFirst({
            where: { id: parsed.cohortId, organizationId: access.context.organizationId },
            select: { id: true },
          })
        : Promise.resolve(null),
      parsed.courseId
        ? db.course.findFirst({
            where: { id: parsed.courseId, organizationId: access.context.organizationId },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve(null),
    ]);

    if (parsed.cohortId && !cohort) {
      return NextResponse.json({ error: "Cohort not found in organization" }, { status: 404 });
    }
    if (parsed.courseId && !course) {
      return NextResponse.json({ error: "Course not found in organization" }, { status: 404 });
    }

    const sessionRow = await db.groupFormationSession.create({
      data: {
        organizationId: access.context.organizationId,
        cohortId: parsed.cohortId || null,
        courseId: parsed.courseId || null,
        title: parsed.title?.trim() || null,
        groupSize: parsed.groupSize,
        mode: parsed.mode,
        leaderMode: parsed.leaderMode,
        startsAt,
        endsAt,
        active: parsed.active,
        createdByUserId: access.context.userId,
      },
      include: {
        cohort: { select: { id: true, displayName: true } },
        course: { select: { id: true, code: true, name: true } },
      },
    });

    const targetStudents = await db.user.findMany({
      where: {
        role: "STUDENT",
        organizationId: access.context.organizationId,
        ...(sessionRow.cohortId ? { cohortId: sessionRow.cohortId } : {}),
        ...(sessionRow.courseId
          ? {
              enrollments: {
                some: {
                  courseId: sessionRow.courseId,
                },
              },
            }
          : {}),
      },
      select: { id: true },
    });

    await enqueueManyJobs(
      targetStudents.map((student) => ({
        type: JobType.SEND_NOTIFICATION,
        payload: {
          userId: student.id,
          type: "SYSTEM",
          title: `Group Formation Open: ${sessionRow.course?.code || "Course"}`,
          body: `${sessionRow.title || "A new group formation session is now available."}`,
          metadata: {
            groupFormationSessionId: sessionRow.id,
            courseId: sessionRow.courseId,
            cohortId: sessionRow.cohortId,
          },
        },
        organizationId: access.context.organizationId,
      }))
    );

    return NextResponse.json({ session: sessionRow }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Create group formation session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

