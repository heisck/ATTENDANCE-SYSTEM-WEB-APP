import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasMatchingScope } from "@/lib/course-rep";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { timetableEntrySchema } from "@/lib/validators";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentRepContext(session.user.id);
  if (!context || !context.isCourseRep) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }

  const rows = await db.timetableEntry.findMany({
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
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    take: 500,
  });

  const filtered = rows.filter((row) =>
    hasMatchingScope(context.scopes, {
      cohortId: row.cohortId,
      courseId: row.courseId,
    })
  );

  return NextResponse.json({ entries: filtered });
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
    const parsed = timetableEntrySchema.parse(body);

    const allowed = hasMatchingScope(context.scopes, {
      cohortId: parsed.cohortId,
      courseId: parsed.courseId || null,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Scope mismatch for this cohort/course" }, { status: 403 });
    }

    const [cohort, course] = await Promise.all([
      db.cohort.findFirst({
        where: {
          id: parsed.cohortId,
          organizationId: context.user.organizationId!,
        },
        select: { id: true },
      }),
      parsed.courseId
        ? db.course.findFirst({
            where: {
              id: parsed.courseId,
              organizationId: context.user.organizationId!,
            },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve(null),
    ]);

    if (!cohort) {
      return NextResponse.json({ error: "Cohort not found" }, { status: 404 });
    }

    if (parsed.courseId && !course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    const entry = await db.timetableEntry.create({
      data: {
        organizationId: context.user.organizationId!,
        cohortId: parsed.cohortId,
        courseId: parsed.courseId || null,
        courseCode: parsed.courseCode.trim().toUpperCase(),
        courseTitle: parsed.courseTitle.trim(),
        lecturerName: parsed.lecturerName?.trim() || null,
        taName: parsed.taName?.trim() || null,
        dayOfWeek: parsed.dayOfWeek,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        venue: parsed.venue?.trim() || null,
        mode: parsed.mode,
        onlineLink: parsed.onlineLink?.trim() || null,
        notes: parsed.notes?.trim() || null,
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
        course: { select: { id: true, code: true, name: true } },
      },
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }

    console.error("Create timetable entry error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}