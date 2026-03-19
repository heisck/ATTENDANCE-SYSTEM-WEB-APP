import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { getHistoricalPhaseFromSession, resolveSessionFamilyKey } from "@/lib/session-flow";

type CourseFamilySummary = {
  familyKey: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  startedAt: Date;
  phaseOneSessions: number;
  phaseTwoSessions: number;
  phaseOneDone: boolean;
  phaseTwoDone: boolean;
  flagged: boolean;
  weekNumber: number;
};

function getUtcDateValue(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getWeekNumber(date: Date, baseline: Date) {
  const diffMs = getUtcDateValue(date) - getUtcDateValue(baseline);
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function renderStatusBadge(text: string) {
  return (
    <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
      {text}
    </span>
  );
}

function renderResultBadge(entry: CourseFamilySummary) {
  if (entry.phaseOneDone && entry.phaseTwoDone) {
    return renderStatusBadge("Present");
  }

  if (entry.phaseOneDone) {
    return renderStatusBadge("Opening Only");
  }

  if (entry.phaseTwoDone) {
    return renderStatusBadge("Closing Only");
  }

  return renderStatusBadge("Absent");
}

function renderPhaseBadge(marked: boolean, opened: number) {
  if (marked) {
    return renderStatusBadge("Marked");
  }

  if (opened > 0) {
    return renderStatusBadge("Missed");
  }

  return renderStatusBadge("Not Opened");
}

function buildNotes(entry: CourseFamilySummary) {
  const parts: string[] = [];
  if (entry.phaseOneSessions > 0) {
    parts.push(`Phase 1 x${entry.phaseOneSessions}`);
  }
  if (entry.phaseTwoSessions > 0) {
    parts.push(`Phase 2 x${entry.phaseTwoSessions}`);
  }
  if (entry.flagged) {
    parts.push("Flagged attempt recorded");
  }
  return parts.join(" | ") || "No attendance activity yet";
}

export default async function StudentHistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const gate = await getStudentGateState(session.user.id);
  if (gate.redirectPath) redirect(gate.redirectPath);

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
    orderBy: {
      course: {
        code: "asc",
      },
    },
  });

  const courseIds = enrollments.map((entry) => entry.courseId);
  const attendanceSessions =
    courseIds.length > 0
      ? await db.attendanceSession.findMany({
          where: {
            courseId: { in: courseIds },
          },
          select: {
            id: true,
            courseId: true,
            lecturerId: true,
            sessionFamilyId: true,
            sessionFlow: true,
            phase: true,
            startedAt: true,
            course: {
              select: {
                code: true,
                name: true,
              },
            },
            records: {
              where: { studentId: session.user.id },
              select: {
                id: true,
                flagged: true,
              },
            },
          },
          orderBy: { startedAt: "asc" },
        })
      : [];

  const familyMap = new Map<string, Omit<CourseFamilySummary, "weekNumber">>();
  for (const sessionRow of attendanceSessions) {
    const familyKey = resolveSessionFamilyKey({
      sessionFamilyId: sessionRow.sessionFamilyId,
      courseId: sessionRow.courseId,
      lecturerId: sessionRow.lecturerId,
      startedAt: sessionRow.startedAt,
    });

    const existing = familyMap.get(familyKey) ?? {
      familyKey,
      courseId: sessionRow.courseId,
      courseCode: sessionRow.course.code,
      courseName: sessionRow.course.name,
      startedAt: sessionRow.startedAt,
      phaseOneSessions: 0,
      phaseTwoSessions: 0,
      phaseOneDone: false,
      phaseTwoDone: false,
      flagged: false,
    };

    if (sessionRow.startedAt < existing.startedAt) {
      existing.startedAt = sessionRow.startedAt;
    }

    const historicalPhase = getHistoricalPhaseFromSession({
      sessionFlow: sessionRow.sessionFlow,
      phase: sessionRow.phase,
    });

    if (historicalPhase === "PHASE_ONE") {
      existing.phaseOneSessions += 1;
    } else if (historicalPhase === "PHASE_TWO") {
      existing.phaseTwoSessions += 1;
    }

    const studentMarkedThisSession = sessionRow.records.length > 0;
    if (studentMarkedThisSession && historicalPhase === "PHASE_ONE") {
      existing.phaseOneDone = true;
    }
    if (studentMarkedThisSession && historicalPhase === "PHASE_TWO") {
      existing.phaseTwoDone = true;
    }
    if (sessionRow.records.some((record) => record.flagged)) {
      existing.flagged = true;
    }

    familyMap.set(familyKey, existing);
  }

  const familyEntries = Array.from(familyMap.values()).sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
  );
  const baselineDate = familyEntries[0]?.startedAt ?? new Date();
  const familySummaries: CourseFamilySummary[] = familyEntries.map((entry) => ({
    ...entry,
    weekNumber: getWeekNumber(entry.startedAt, baselineDate),
  }));

  const courseSections = enrollments.map(({ course }) => {
    const families = familySummaries
      .filter((entry) => entry.courseId === course.id)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const fullyPresent = families.filter(
      (entry) => entry.phaseOneDone && entry.phaseTwoDone
    ).length;
    const partial = families.filter(
      (entry) =>
        (entry.phaseOneDone || entry.phaseTwoDone) &&
        !(entry.phaseOneDone && entry.phaseTwoDone)
    ).length;
    const missed = families.filter(
      (entry) => !entry.phaseOneDone && !entry.phaseTwoDone
    ).length;
    const attendanceRate =
      families.length > 0 ? Math.round((fullyPresent / families.length) * 100) : 0;
    const weeks = Array.from(
      families.reduce((map, entry) => {
        const current = map.get(entry.weekNumber) ?? [];
        current.push(entry);
        map.set(entry.weekNumber, current);
        return map;
      }, new Map<number, CourseFamilySummary[]>())
    ).sort((a, b) => a[0] - b[0]);

    return {
      courseId: course.id,
      code: course.code,
      name: course.name,
      families,
      fullyPresent,
      partial,
      missed,
      attendanceRate,
      flagged: families.filter((entry) => entry.flagged).length,
      weeks,
    };
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Weekly attendance by course. Full presence is counted only when you complete both
        Phase 1 and Phase 2 for the same class session.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {courseSections.map((course) => (
          <div key={course.courseId} className="surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{course.code}</p>
                <p className="text-xs text-muted-foreground">{course.name}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  course.attendanceRate < 75
                    ? "border border-destructive/30 bg-destructive/10 text-destructive"
                    : "border border-border bg-muted/40 text-foreground"
                }`}
              >
                {course.attendanceRate}%
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <p>Total Classes: {course.families.length}</p>
              <p>Present: {course.fullyPresent}</p>
              <p>Partial: {course.partial}</p>
              <p>Missed: {course.missed}</p>
              <p>Flagged: {course.flagged}</p>
            </div>
          </div>
        ))}
        {courseSections.length === 0 && (
          <div className="surface p-4 text-sm text-muted-foreground sm:col-span-2">
            No enrolled courses found.
          </div>
        )}
      </div>

      {courseSections.map((course) => (
        <section key={course.courseId} className="space-y-4">
          <div className="surface p-4">
            <p className="text-sm font-semibold">{course.code}</p>
            <p className="text-sm text-muted-foreground">{course.name}</p>
          </div>

          {course.weeks.length === 0 ? (
            <div className="surface p-4 text-sm text-muted-foreground">
              No class sessions recorded yet for this course.
            </div>
          ) : (
            course.weeks.map(([weekNumber, entries]) => (
              <div key={`${course.courseId}-week-${weekNumber}`} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold tracking-tight">Week {weekNumber}</h2>
                  <p className="text-xs text-muted-foreground">
                    {entries.length} class session{entries.length === 1 ? "" : "s"}
                  </p>
                </div>

                <AttendanceTable
                  columns={[
                    { key: "date", label: "Date" },
                    { key: "opening", label: "Opening" },
                    { key: "closing", label: "Closing" },
                    { key: "result", label: "Result" },
                    { key: "notes", label: "Notes" },
                  ]}
                  data={entries.map((entry) => ({
                    date: entry.startedAt.toLocaleDateString(),
                    opening: renderPhaseBadge(entry.phaseOneDone, entry.phaseOneSessions),
                    closing: renderPhaseBadge(entry.phaseTwoDone, entry.phaseTwoSessions),
                    result: renderResultBadge(entry),
                    notes: buildNotes(entry),
                  }))}
                  emptyMessage="No attendance entries for this week."
                />
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
