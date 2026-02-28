import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";
import { enqueueManyJobs } from "@/lib/job-queue";
import { examUpdateSchema } from "@/lib/validators";

async function canManageExam(sessionUser: any, exam: { organizationId: string; cohortId: string | null; courseId: string | null }) {
  if (isAdminLike(sessionUser.role)) {
    if (sessionUser.role === "ADMIN" && sessionUser.organizationId !== exam.organizationId) {
      return { ok: false as const, status: 403, error: "Forbidden" };
    }
    const org = await db.organization.findUnique({
      where: { id: exam.organizationId },
      select: { settings: true },
    });
    if (!org) return { ok: false as const, status: 404, error: "Organization not found" };
    const flags = getFeatureFlags(org.settings);
    if (!flags.studentHubCore || !flags.examHub) {
      return { ok: false as const, status: 403, error: "examHub feature is disabled" };
    }
    return { ok: true as const, userId: sessionUser.id };
  }

  const rep = await getStudentRepContext(sessionUser.id);
  if (!rep || !rep.isCourseRep || rep.user.organizationId !== exam.organizationId) {
    return { ok: false as const, status: 403, error: "Course Rep access required" };
  }
  if (!rep.featureFlags.studentHubCore || !rep.featureFlags.examHub) {
    return { ok: false as const, status: 403, error: "examHub feature is disabled" };
  }
  const allowed = hasMatchingScope(rep.scopes, {
    cohortId: exam.cohortId,
    courseId: exam.courseId,
  });
  if (!allowed) {
    return { ok: false as const, status: 403, error: "Scope mismatch for exam resource" };
  }
  return { ok: true as const, userId: rep.user.id };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const exam = await db.examEntry.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      cohortId: true,
      courseId: true,
    },
  });
  if (!exam) {
    return NextResponse.json({ error: "Exam entry not found" }, { status: 404 });
  }

  const permission = await canManageExam(session.user as any, exam);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  const updates = await db.examUpdate.findMany({
    where: { examEntryId: id },
    orderBy: { effectiveAt: "desc" },
  });

  return NextResponse.json({ updates });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const exam = await db.examEntry.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      cohortId: true,
      courseId: true,
      title: true,
      course: { select: { code: true } },
    },
  });
  if (!exam) {
    return NextResponse.json({ error: "Exam entry not found" }, { status: 404 });
  }

  const permission = await canManageExam(session.user as any, exam);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  try {
    const body = await request.json();
    const parsed = examUpdateSchema.parse(body);

    const update = await db.examUpdate.create({
      data: {
        examEntryId: exam.id,
        updateType: parsed.updateType.trim(),
        message: parsed.message.trim(),
        effectiveAt: new Date(parsed.effectiveAt),
        payload: (parsed.payload || {}) as any,
        createdByUserId: permission.userId,
      },
    });

    const targetStudents = await db.user.findMany({
      where: {
        role: "STUDENT",
        organizationId: exam.organizationId,
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
          title: `Exam Update: ${exam.course?.code || exam.title}`,
          body: update.message,
          metadata: {
            examId: exam.id,
            examUpdateId: update.id,
            courseId: exam.courseId,
            cohortId: exam.cohortId,
          },
        },
        organizationId: exam.organizationId,
      }))
    );

    return NextResponse.json({ update }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Create exam update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

