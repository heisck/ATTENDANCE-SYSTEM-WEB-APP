import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { getStudentPhaseCompletionForCourseDay } from "@/lib/phase-completion";

export default async function StudentHistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const gate = await getStudentGateState(session.user.id);
  if (gate.redirectPath) redirect(gate.redirectPath);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const enrollments = await db.enrollment.findMany({
    where: { studentId: session.user.id },
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

  const courseIds = enrollments.map((entry) => entry.courseId);
  const monthSessions =
    courseIds.length > 0
      ? await db.attendanceSession.findMany({
          where: {
            courseId: { in: courseIds },
            startedAt: {
              gte: monthStart,
              lt: monthEnd,
            },
          },
          select: {
            id: true,
            courseId: true,
            startedAt: true,
          },
        })
      : [];

  const monthSessionIds = monthSessions.map((entry) => entry.id);
  const monthRecords =
    monthSessionIds.length > 0
      ? await db.attendanceRecord.findMany({
          where: {
            studentId: session.user.id,
            sessionId: { in: monthSessionIds },
          },
          select: {
            sessionId: true,
            flagged: true,
          },
        })
      : [];

  const monthRecordBySessionId = new Map(monthRecords.map((record) => [record.sessionId, record]));
  const monthCourseSessions = new Map<string, { id: string; startedAt: Date }[]>();
  for (const sessionRow of monthSessions) {
    if (!monthCourseSessions.has(sessionRow.courseId)) {
      monthCourseSessions.set(sessionRow.courseId, []);
    }
    monthCourseSessions.get(sessionRow.courseId)!.push({
      id: sessionRow.id,
      startedAt: sessionRow.startedAt,
    });
  }

  const courseSummary = enrollments.map(({ course }) => {
    const sessions = monthCourseSessions.get(course.id) || [];
    let attended = 0;
    let flagged = 0;
    for (const item of sessions) {
      const record = monthRecordBySessionId.get(item.id);
      if (!record) continue;
      attended += 1;
      if (record.flagged) flagged += 1;
    }

    const totalSessions = sessions.length;
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
      flagged,
      atRisk,
    };
  });

  const records = await db.attendanceRecord.findMany({
    where: { studentId: session.user.id },
    include: {
      session: { include: { course: true } },
    },
    orderBy: { markedAt: "desc" },
  });

  const completionInputByKey = new Map<
    string,
    { courseId: string; lecturerId: string; referenceTime: Date }
  >();
  for (const record of records) {
    const key = [
      record.session.courseId,
      record.session.lecturerId,
      record.session.startedAt.toISOString().slice(0, 10),
    ].join(":");
    if (!completionInputByKey.has(key)) {
      completionInputByKey.set(key, {
        courseId: record.session.courseId,
        lecturerId: record.session.lecturerId,
        referenceTime: record.session.startedAt,
      });
    }
  }

  const completionByKey = new Map(
    await Promise.all(
      Array.from(completionInputByKey.entries()).map(async ([key, input]) => {
        const completion = await getStudentPhaseCompletionForCourseDay({
          studentId: session.user.id,
          courseId: input.courseId,
          lecturerId: input.lecturerId,
          referenceTime: input.referenceTime,
        });
        return [key, completion] as const;
      })
    )
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Detailed monthly and course-level attendance records.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {courseSummary.map((course) => (
          <div key={course.courseId} className="surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{course.code}</p>
                <p className="text-xs text-muted-foreground">{course.name}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  course.atRisk
                    ? "border border-destructive/30 bg-destructive/10 text-destructive"
                    : "border border-border bg-muted/40 text-foreground"
                }`}
              >
                {course.atRisk ? "At Risk" : "On Track"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <p>Total: {course.totalSessions}</p>
              <p>Attended: {course.attended}</p>
              <p>Missed: {course.missed}</p>
              <p>Rate: {course.attendanceRate}%</p>
              <p>Flagged: {course.flagged}</p>
            </div>
          </div>
        ))}
        {courseSummary.length === 0 && (
          <div className="surface p-4 text-sm text-muted-foreground sm:col-span-2">
            No enrolled courses found.
          </div>
        )}
      </div>

      <AttendanceTable
        columns={[
          { key: "course", label: "Course" },
          { key: "date", label: "Date" },
          { key: "time", label: "Time" },
          { key: "webauthn", label: "Biometric" },
          { key: "confidence", label: "Confidence" },
          { key: "status", label: "Status" },
        ]}
        data={records.map((r) => {
          const completionKey = [
            r.session.courseId,
            r.session.lecturerId,
            r.session.startedAt.toISOString().slice(0, 10),
          ].join(":");
          const phaseState = completionByKey.get(completionKey);

          return {
            course: `${r.session.course.code} - ${r.session.course.name}`,
            date: r.markedAt.toLocaleDateString(),
            time: r.markedAt.toLocaleTimeString(),
            webauthn: r.webauthnUsed ? "Yes" : "No",
            confidence: `${r.confidence}%`,
            status: r.flagged
              ? "Flagged"
              : phaseState?.overallPresent
                ? "Present (Phase 1 + 2)"
                : phaseState?.pendingPhase === "PHASE_TWO"
                  ? "Phase 1 Done (Pending Phase 2)"
                  : phaseState?.pendingPhase === "PHASE_ONE"
                    ? "Phase 1 Missing"
                    : "Recorded",
          };
        })}
        emptyMessage="No attendance history yet."
      />
    </div>
  );
}
