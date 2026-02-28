import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasMatchingScope } from "@/lib/course-rep";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { timetableEntrySchema } from "@/lib/validators";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentRepContext(session.user.id);
  if (!context || !context.isCourseRep) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = timetableEntrySchema.parse(body);

    const existing = await db.timetableEntry.findFirst({
      where: {
        id,
        organizationId: context.user.organizationId!,
      },
      select: {
        id: true,
        cohortId: true,
        courseId: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Timetable entry not found" }, { status: 404 });
    }

    const canEditExisting = hasMatchingScope(context.scopes, {
      cohortId: existing.cohortId,
      courseId: existing.courseId,
    });

    const canMoveToTarget = hasMatchingScope(context.scopes, {
      cohortId: parsed.cohortId,
      courseId: parsed.courseId || null,
    });

    if (!canEditExisting || !canMoveToTarget) {
      return NextResponse.json({ error: "Scope mismatch for this update" }, { status: 403 });
    }

    const updated = await db.timetableEntry.update({
      where: { id },
      data: {
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

    return NextResponse.json({ entry: updated });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Update timetable entry error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentRepContext(session.user.id);
  if (!context || !context.isCourseRep) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await db.timetableEntry.findFirst({
    where: {
      id,
      organizationId: context.user.organizationId!,
    },
    select: {
      id: true,
      cohortId: true,
      courseId: true,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Timetable entry not found" }, { status: 404 });
  }

  const allowed = hasMatchingScope(context.scopes, {
    cohortId: existing.cohortId,
    courseId: existing.courseId,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Scope mismatch for this delete" }, { status: 403 });
  }

  await db.timetableEntry.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}