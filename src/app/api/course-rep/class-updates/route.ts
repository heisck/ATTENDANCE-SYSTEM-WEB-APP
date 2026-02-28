import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasMatchingScope } from "@/lib/course-rep";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { classUpdateSchema } from "@/lib/validators";
import { enqueueManyJobs } from "@/lib/job-queue";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentRepContext(session.user.id);
  if (!context || !context.isCourseRep) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }

  const rows = await db.classUpdate.findMany({
    where: {
      organizationId: context.user.organizationId!,
      isActive: true,
    },
    include: {
      cohort: {
        select: {
          id: true,
          displayName: true,
          department: true,
          level: true,
          groupCode: true,
        },
      },
      course: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: { effectiveAt: "desc" },
    take: 500,
  });

  const filtered = rows.filter((row) =>
    hasMatchingScope(context.scopes, {
      cohortId: row.cohortId,
      courseId: row.courseId,
    })
  );

  return NextResponse.json({ updates: filtered });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentRepContext(session.user.id);
  if (!context || !context.isCourseRep) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = classUpdateSchema.parse(body);

    const allowed = hasMatchingScope(context.scopes, {
      cohortId: parsed.cohortId || null,
      courseId: parsed.courseId || null,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Scope mismatch for this target" }, { status: 403 });
    }

    const update = await db.classUpdate.create({
      data: {
        organizationId: context.user.organizationId!,
        cohortId: parsed.cohortId || null,
        courseId: parsed.courseId || null,
        type: parsed.type,
        title: parsed.title.trim(),
        message: parsed.message.trim(),
        effectiveAt: new Date(parsed.effectiveAt),
        payload: (parsed.payload || {}) as any,
        createdByUserId: context.user.id,
      },
      include: {
        cohort: {
          select: {
            id: true,
            displayName: true,
            department: true,
            level: true,
            groupCode: true,
          },
        },
        course: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    const targetStudents = await db.user.findMany({
      where: {
        role: "STUDENT",
        organizationId: context.user.organizationId!,
        ...(parsed.cohortId ? { cohortId: parsed.cohortId } : {}),
        ...(parsed.courseId
          ? {
              enrollments: {
                some: {
                  courseId: parsed.courseId,
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
          title: `Class Update: ${update.title}`,
          body: update.message,
          metadata: {
            classUpdateId: update.id,
            courseId: update.courseId,
            cohortId: update.cohortId,
            updateType: update.type,
          },
        },
        organizationId: context.user.organizationId!,
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
    console.error("Create class update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
