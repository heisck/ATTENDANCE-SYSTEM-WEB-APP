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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json({ error: "Only students can view this report" }, { status: 403 });
  }

  const { courseId } = await params;
  const monthParam = new URL(request.url).searchParams.get("month");
  const range = getMonthRange(monthParam);

  const enrollment = await db.enrollment.findUnique({
    where: {
      courseId_studentId: {
        courseId,
        studentId: user.id,
      },
    },
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

  if (!enrollment) {
    return NextResponse.json({ error: "Not enrolled in this course" }, { status: 403 });
  }

  const sessions = await db.attendanceSession.findMany({
    where: {
      courseId,
      startedAt: {
        gte: range.start,
        lt: range.end,
      },
    },
    select: {
      id: true,
      startedAt: true,
      status: true,
      phase: true,
    },
    orderBy: { startedAt: "asc" },
  });

  const records = await db.attendanceRecord.findMany({
    where: {
      studentId: user.id,
      sessionId: { in: sessions.map((s) => s.id) },
    },
    select: {
      sessionId: true,
      markedAt: true,
      confidence: true,
      flagged: true,
      reverifyStatus: true,
      reverifyRequired: true,
    },
  });

  const recordMap = new Map(records.map((record) => [record.sessionId, record]));

  const timeline = sessions.map((sessionItem) => {
    const record = recordMap.get(sessionItem.id);
    return {
      sessionId: sessionItem.id,
      sessionDate: sessionItem.startedAt,
      attended: Boolean(record),
      markedAt: record?.markedAt || null,
      confidence: record?.confidence ?? null,
      flagged: record?.flagged ?? false,
      reverifyRequired: record?.reverifyRequired ?? false,
      reverifyStatus: record?.reverifyStatus ?? null,
      sessionStatus: sessionItem.status,
      sessionPhase: sessionItem.phase,
    };
  });

  const attended = timeline.filter((row) => row.attended).length;
  const totalSessions = timeline.length;
  const missed = Math.max(totalSessions - attended, 0);
  const attendanceRate = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
  const flaggedRecords = timeline.filter((row) => row.flagged).length;
  const missedRecent = timeline.slice(-5).filter((row) => !row.attended).length;
  const atRisk = attendanceRate < 75 || missedRecent >= 2;

  return NextResponse.json({
    month: range.key,
    course: enrollment.course,
    summary: {
      totalSessions,
      attended,
      missed,
      attendanceRate,
      flaggedRecords,
      missedRecent,
      atRisk,
    },
    timeline,
  });
}
