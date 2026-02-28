import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasMatchingScope } from "@/lib/course-rep";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { assignmentAnnouncementSchema } from "@/lib/validators";
import { enqueueManyJobs } from "@/lib/job-queue";

const DEFAULT_ASSIGNMENT_OFFSETS_MIN = [1440, 360, 120, 60];

function getReminderOffsets(preference: {
  assignmentRemindersEnabled: boolean;
  assignmentReminderOffsetsMin: number[];
} | null): number[] {
  if (!preference || !preference.assignmentRemindersEnabled) {
    return [];
  }

  const offsets = Array.isArray(preference.assignmentReminderOffsetsMin)
    ? preference.assignmentReminderOffsetsMin
    : DEFAULT_ASSIGNMENT_OFFSETS_MIN;

  return Array.from(new Set(offsets.filter((value) => Number.isFinite(value) && value > 0))).sort(
    (a, b) => b - a
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentRepContext(session.user.id);
  if (!context || !context.isCourseRep) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }

  const announcements = await db.assignmentAnnouncement.findMany({
    where: {
      organizationId: context.user.organizationId!,
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
      attachments: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const filtered = announcements.filter((item) =>
    hasMatchingScope(context.scopes, {
      cohortId: item.cohortId,
      courseId: item.courseId,
    })
  );

  return NextResponse.json({ announcements: filtered });
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
    const parsed = assignmentAnnouncementSchema.parse(body);

    const allowed = hasMatchingScope(context.scopes, {
      cohortId: parsed.cohortId || null,
      courseId: parsed.courseId || null,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Scope mismatch for this target" }, { status: 403 });
    }

    const dueAt = new Date(parsed.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: "Invalid dueAt value" }, { status: 400 });
    }

    const announcement = await db.assignmentAnnouncement.create({
      data: {
        organizationId: context.user.organizationId!,
        cohortId: parsed.cohortId || null,
        courseId: parsed.courseId || null,
        title: parsed.title.trim(),
        body: parsed.body.trim(),
        dueAt,
        submissionNote: parsed.submissionNote?.trim() || null,
        isGroupAssignment: parsed.isGroupAssignment,
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
      select: {
        id: true,
        notificationPreference: {
          select: {
            assignmentRemindersEnabled: true,
            assignmentReminderOffsetsMin: true,
          },
        },
      },
    });

    const now = Date.now();
    const notificationJobs: Array<{
      type: JobType;
      payload: Record<string, any>;
      runAt?: Date;
      organizationId?: string | null;
    }> = [];

    for (const student of targetStudents) {
      notificationJobs.push({
        type: JobType.SEND_NOTIFICATION,
        payload: {
          userId: student.id,
          type: "SYSTEM",
          title: `New Assignment: ${announcement.title}`,
          body: `Due ${announcement.dueAt.toLocaleString()}`,
          metadata: {
            assignmentId: announcement.id,
            courseId: announcement.courseId,
            cohortId: announcement.cohortId,
          },
        },
        organizationId: context.user.organizationId!,
      });

      const offsets = getReminderOffsets(student.notificationPreference);
      for (const offsetMin of offsets) {
        const runAtTs = announcement.dueAt.getTime() - offsetMin * 60_000;
        if (runAtTs <= now) continue;

        notificationJobs.push({
          type: JobType.ASSIGNMENT_REMINDER,
          payload: {
            userId: student.id,
            title: `Assignment Due Soon: ${announcement.title}`,
            body: `Due in ${offsetMin >= 60 ? `${Math.round(offsetMin / 60)}h` : `${offsetMin}m`}.`,
            metadata: {
              assignmentId: announcement.id,
              offsetMin,
            },
          },
          runAt: new Date(runAtTs),
          organizationId: context.user.organizationId!,
        });
      }
    }

    await enqueueManyJobs(notificationJobs);

    return NextResponse.json({ announcement }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Create assignment announcement error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}