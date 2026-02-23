import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

function getMonthRange(inputMonth?: string | null) {
  const now = new Date();
  const [year, month] =
    inputMonth && /^\d{4}-\d{2}$/.test(inputMonth)
      ? inputMonth.split("-").map((part) => Number(part))
      : [now.getFullYear(), now.getMonth() + 1];

  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end, key: `${year}-${String(month).padStart(2, "0")}` };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json({ error: "Only students can view this report" }, { status: 403 });
  }

  const monthParam = new URL(request.url).searchParams.get("month");
  const range = getMonthRange(monthParam);

  const enrollments = await db.enrollment.findMany({
    where: { studentId: user.id },
    include: {
      course: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  });

  const courseIds = enrollments.map((e) => e.courseId);
  if (courseIds.length === 0) {
    return NextResponse.json({
      month: range.key,
      totals: {
        totalCourses: 0,
        totalSessions: 0,
        attended: 0,
        missed: 0,
        attendanceRate: 0,
      },
      courses: [],
    });
  }

  const sessions = await db.attendanceSession.findMany({
    where: {
      courseId: { in: courseIds },
      startedAt: {
        gte: range.start,
        lt: range.end,
      },
    },
    select: {
      id: true,
      courseId: true,
      startedAt: true,
    },
    orderBy: { startedAt: "asc" },
  });

  const sessionIds = sessions.map((s) => s.id);
  const records =
    sessionIds.length === 0
      ? []
      : await db.attendanceRecord.findMany({
          where: {
            studentId: user.id,
            sessionId: { in: sessionIds },
          },
          select: {
            sessionId: true,
            flagged: true,
            reverifyStatus: true,
            markedAt: true,
          },
        });

  const recordBySessionId = new Map(records.map((r) => [r.sessionId, r]));

  const sessionsByCourse = new Map<string, { id: string; startedAt: Date }[]>();
  for (const sessionRow of sessions) {
    if (!sessionsByCourse.has(sessionRow.courseId)) {
      sessionsByCourse.set(sessionRow.courseId, []);
    }
    sessionsByCourse.get(sessionRow.courseId)!.push({
      id: sessionRow.id,
      startedAt: sessionRow.startedAt,
    });
  }

  const courseSummaries = enrollments.map(({ course }) => {
    const courseSessions = sessionsByCourse.get(course.id) ?? [];
    let attended = 0;
    let flagged = 0;
    let reverifyPassed = 0;
    let reverifyMissedOrFailed = 0;

    for (const sessionItem of courseSessions) {
      const record = recordBySessionId.get(sessionItem.id);
      if (!record) continue;
      attended += 1;
      if (record.flagged) flagged += 1;
      if (record.reverifyStatus === "PASSED" || record.reverifyStatus === "MANUAL_PRESENT") {
        reverifyPassed += 1;
      }
      if (record.reverifyStatus === "MISSED" || record.reverifyStatus === "FAILED") {
        reverifyMissedOrFailed += 1;
      }
    }

    const totalSessions = courseSessions.length;
    const missed = Math.max(totalSessions - attended, 0);
    const attendanceRate = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
    const atRisk = attendanceRate < 75 || missed >= 2;

    return {
      courseId: course.id,
      code: course.code,
      name: course.name,
      totalSessions,
      attended,
      missed,
      attendanceRate,
      flaggedRecords: flagged,
      reverifyPassed,
      reverifyMissedOrFailed,
      atRisk,
    };
  });

  const totals = courseSummaries.reduce(
    (acc, row) => {
      acc.totalCourses += 1;
      acc.totalSessions += row.totalSessions;
      acc.attended += row.attended;
      acc.missed += row.missed;
      return acc;
    },
    { totalCourses: 0, totalSessions: 0, attended: 0, missed: 0, attendanceRate: 0 }
  );
  totals.attendanceRate =
    totals.totalSessions > 0 ? Math.round((totals.attended / totals.totalSessions) * 100) : 0;

  return NextResponse.json({
    month: range.key,
    totals,
    courses: courseSummaries.sort((a, b) => a.code.localeCompare(b.code)),
  });
}
