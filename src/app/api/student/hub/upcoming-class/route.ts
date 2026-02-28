import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";

function weekdayMonFirst(date: Date) {
  return ((date.getDay() + 6) % 7) + 1;
}

function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function getNextOccurrence(entry: { dayOfWeek: number; startTime: string; endTime: string }, now: Date) {
  const nowWeekday = weekdayMonFirst(now);
  const startMin = toMinutes(entry.startTime);
  const endMin = toMinutes(entry.endTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  let offsetDays = entry.dayOfWeek - nowWeekday;
  if (offsetDays < 0 || (offsetDays === 0 && startMin <= nowMin)) {
    offsetDays += 7;
  }

  const startAt = new Date(now);
  startAt.setDate(now.getDate() + offsetDays);
  startAt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);

  const endAt = new Date(startAt);
  endAt.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
  if (endMin <= startMin) {
    endAt.setDate(endAt.getDate() + 1);
  }

  return { startAt, endAt };
}

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
    return NextResponse.json({ upcomingClass: null });
  }
  if (!context.featureFlags.studentHubCore) {
    return NextResponse.json({ error: "Student hub is disabled" }, { status: 404 });
  }
  if (!context.cohortId) {
    return NextResponse.json({
      upcomingClass: null,
      message: "Complete profile to attach a cohort and view timetable.",
    });
  }

  const entries = await db.timetableEntry.findMany({
    where: {
      organizationId: context.organizationId,
      cohortId: context.cohortId,
      isActive: true,
    },
    include: {
      course: {
        select: { id: true, code: true, name: true },
      },
      cohort: {
        select: { id: true, displayName: true },
      },
    },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    take: 200,
  });

  if (entries.length === 0) {
    return NextResponse.json({ upcomingClass: null });
  }

  const now = new Date();
  const next = entries
    .map((entry) => {
      const occurrence = getNextOccurrence(entry, now);
      return { entry, ...occurrence };
    })
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];

  if (!next) {
    return NextResponse.json({ upcomingClass: null });
  }

  const millisUntilStart = Math.max(next.startAt.getTime() - now.getTime(), 0);
  const minutesUntilStart = Math.ceil(millisUntilStart / 60_000);

  return NextResponse.json({
    upcomingClass: {
      id: next.entry.id,
      courseId: next.entry.courseId,
      courseCode: next.entry.course?.code || next.entry.courseCode,
      courseTitle: next.entry.course?.name || next.entry.courseTitle,
      cohort: next.entry.cohort,
      dayOfWeek: next.entry.dayOfWeek,
      startTime: next.entry.startTime,
      endTime: next.entry.endTime,
      venue: next.entry.venue,
      mode: next.entry.mode,
      onlineLink: next.entry.onlineLink,
      lecturerName: next.entry.lecturerName,
      startAt: next.startAt.toISOString(),
      endAt: next.endAt.toISOString(),
      minutesUntilStart,
    },
    now: now.toISOString(),
  });
}

