import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deriveAttendancePhase } from "@/lib/attendance";
import { LecturerSessionHistoryPanel, type LecturerSessionHistoryItem } from "@/components/lecturer-session-history-panel";
import { getHistoricalPhaseFromSession } from "@/lib/session-flow";

export default async function LecturerHistoryPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const now = new Date();
  const sessions = await db.attendanceSession.findMany({
    where: {
      lecturerId: session.user.id,
      OR: [{ status: "CLOSED" }, { endsAt: { lte: now } }],
    },
    include: {
      course: {
        select: {
          code: true,
          name: true,
        },
      },
      _count: {
        select: {
          records: true,
        },
      },
    },
    orderBy: {
      startedAt: "desc",
    },
    take: 100,
  });

  const initialSessions: LecturerSessionHistoryItem[] = sessions.map((sessionRow) => ({
    id: sessionRow.id,
    course: {
      code: sessionRow.course.code,
      name: sessionRow.course.name,
    },
    sessionFlow: sessionRow.sessionFlow,
    status:
      deriveAttendancePhase(
        {
          status: sessionRow.status,
          phase: sessionRow.phase,
          endsAt: sessionRow.endsAt,
        },
        now
      ) === "CLOSED"
        ? "CLOSED"
        : "ACTIVE",
    phase:
      deriveAttendancePhase(
        {
          status: sessionRow.status,
          phase: sessionRow.phase,
          endsAt: sessionRow.endsAt,
        },
        now
      ) === "CLOSED"
        ? "CLOSED"
        : sessionRow.phase,
    historicalPhase: getHistoricalPhaseFromSession({
      sessionFlow: sessionRow.sessionFlow,
      phase: sessionRow.phase,
    }),
    startedAt: sessionRow.startedAt.toISOString(),
    endsAt: sessionRow.endsAt.toISOString(),
    closedAt: sessionRow.closedAt?.toISOString() ?? null,
    markedCount: sessionRow._count.records,
  }));

  return <LecturerSessionHistoryPanel initialSessions={initialSessions} />;
}
