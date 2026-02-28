import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike, resolveOrganizationIdForStaff } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";
import { resolveRepOrAdminWriteAccess } from "@/lib/phase2-access";
import { enqueueManyJobs } from "@/lib/job-queue";
import { examEntrySchema } from "@/lib/validators";

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
    if (!flags.studentHubCore || !flags.examHub) {
      return NextResponse.json({ error: "examHub feature is disabled" }, { status: 403 });
    }

    const exams = await db.examEntry.findMany({
      where: { organizationId },
      include: {
        cohort: {
          select: { id: true, displayName: true, department: true, level: true, groupCode: true },
        },
        course: {
          select: { id: true, code: true, name: true },
        },
        attachments: true,
        updates: {
          orderBy: { effectiveAt: "desc" },
          take: 10,
        },
      },
      orderBy: { examDate: "asc" },
      take: 300,
    });

    return NextResponse.json({ exams });
  }

  const repContext = await getStudentRepContext(session.user.id);
  if (!repContext || !repContext.isCourseRep || !repContext.user.organizationId) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }
  if (!repContext.featureFlags.studentHubCore || !repContext.featureFlags.examHub) {
    return NextResponse.json({ error: "examHub feature is disabled" }, { status: 403 });
  }

  const scopedFilter = buildScopeOrFilter(repContext.scopes);
  const exams = await db.examEntry.findMany({
    where: {
      organizationId: repContext.user.organizationId,
      ...(scopedFilter || {}),
    },
    include: {
      cohort: {
        select: { id: true, displayName: true, department: true, level: true, groupCode: true },
      },
      course: {
        select: { id: true, code: true, name: true },
      },
      attachments: true,
      updates: {
        orderBy: { effectiveAt: "desc" },
        take: 10,
      },
    },
    orderBy: { examDate: "asc" },
    take: 300,
  });

  const filtered = exams.filter((exam) =>
    hasMatchingScope(repContext.scopes, { cohortId: exam.cohortId, courseId: exam.courseId })
  );

  return NextResponse.json({ exams: filtered });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = examEntrySchema.parse(body);

    const access = await resolveRepOrAdminWriteAccess({
      sessionUser: {
        id: session.user.id,
        role: session.user.role,
        organizationId: (session.user as any).organizationId ?? null,
      },
      requestedOrganizationId: body?.organizationId ?? null,
      cohortId: parsed.cohortId ?? null,
      courseId: parsed.courseId ?? null,
      requiredFlag: "examHub",
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

    const exam = await db.examEntry.create({
      data: {
        organizationId: access.context.organizationId,
        cohortId: parsed.cohortId || null,
        courseId: parsed.courseId || null,
        title: parsed.title.trim(),
        examDate: new Date(parsed.examDate),
        endAt: parsed.endAt ? new Date(parsed.endAt) : null,
        venue: parsed.venue?.trim() || null,
        allowAnyHall: parsed.allowAnyHall,
        instructions: parsed.instructions?.trim() || null,
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
        ...(exam.cohortId ? { cohortId: exam.cohortId } : {}),
        ...(exam.courseId
          ? {
              enrollments: {
                some: {
                  courseId: exam.courseId,
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
          title: `Exam Update: ${exam.title}`,
          body: `Scheduled for ${new Date(exam.examDate).toLocaleString()}`,
          metadata: {
            examId: exam.id,
            courseId: exam.courseId,
            cohortId: exam.cohortId,
          },
        },
        organizationId: access.context.organizationId,
      }))
    );

    return NextResponse.json({ exam }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Create exam entry error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

