import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getStudentHubContext } from "@/lib/student-hub";

function weekdayMonFirst(date: Date) {
  return ((date.getDay() + 6) % 7) + 1;
}

function dayLabel(dayOfWeek: number) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return labels[Math.max(1, Math.min(7, dayOfWeek)) - 1];
}

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
    return NextResponse.json({ entries: [], grouped: [] });
  }
  if (!context.featureFlags.studentHubCore) {
    return NextResponse.json({ error: "Student hub is disabled" }, { status: 404 });
  }
  if (!context.cohortId) {
    return NextResponse.json({ entries: [], grouped: [] });
  }

  const view = new URL(request.url).searchParams.get("view") === "today" ? "today" : "week";
  const today = weekdayMonFirst(new Date());

  const entries = await db.timetableEntry.findMany({
    where: {
      organizationId: context.organizationId,
      cohortId: context.cohortId,
      isActive: true,
      ...(view === "today" ? { dayOfWeek: today } : {}),
    },
    include: {
      course: {
        select: { id: true, code: true, name: true },
      },
      cohort: {
        select: { id: true, displayName: true, department: true, level: true, groupCode: true },
      },
    },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    take: 300,
  });

  const grouped = entries.reduce<Record<string, typeof entries>>((acc, entry) => {
    const key = dayLabel(entry.dayOfWeek);
    acc[key] ||= [];
    acc[key].push(entry);
    return acc;
  }, {});

  return NextResponse.json({
    view,
    entries,
    grouped: Object.entries(grouped).map(([day, rows]) => ({ day, rows })),
  });
}

