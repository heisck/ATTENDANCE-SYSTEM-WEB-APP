import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";
import { redirect } from "next/navigation";
import { getHistoricalPhaseFromSession, resolveSessionFamilyKey } from "@/lib/session-flow";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  Clock3,
  LogIn,
  LogOut,
} from "lucide-react";

type CourseFamilySummary = {
  familyKey: string;
  courseId: string;
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

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

function getToneClasses(tone: "default" | "muted" | "destructive" = "default") {
  if (tone === "destructive") {
    return "border-destructive/20 bg-destructive/5 text-destructive";
  }

  if (tone === "muted") {
    return "border-border/70 bg-background/70 text-muted-foreground";
  }

  return "border-border bg-muted/40 text-foreground";
}

function renderMetaBadge(
  text: string,
  tone: "default" | "muted" | "destructive" = "default"
) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${getToneClasses(
        tone
      )}`}
    >
      {text}
    </span>
  );
}

function renderResultBadge(entry: CourseFamilySummary) {
  if (entry.phaseOneDone && entry.phaseTwoDone) {
    return renderMetaBadge("Present");
  }

  if (entry.phaseOneDone) {
    return renderMetaBadge("Opening Only", "muted");
  }

  if (entry.phaseTwoDone) {
    return renderMetaBadge("Closing Only", "muted");
  }

  return renderMetaBadge("Absent", "destructive");
}

function renderPhaseBadge(kind: "Check In" | "Check Out", marked: boolean, opened: number) {
  const Icon = kind === "Check In" ? LogIn : LogOut;

  if (marked) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${getToneClasses()}`}>
        <Icon className="h-3.5 w-3.5" />
        {kind}
      </span>
    );
  }

  if (opened > 0) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${getToneClasses(
          "destructive"
        )}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {kind} Missed
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${getToneClasses(
        "muted"
      )}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {kind} Not Opened
    </span>
  );
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
    };
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Tap a course to expand its weekly attendance history. Full presence is counted only
          when both Phase 1 and Phase 2 are completed for the same class session.
        </p>
      </div>

      {courseSections.length === 0 ? (
        <div className="surface p-4 text-sm text-muted-foreground">
          No enrolled courses found.
        </div>
      ) : (
        <div className="space-y-4">
          {courseSections.map((course, index) => (
            <details
              key={course.courseId}
              className="group surface overflow-hidden"
              open={index === 0}
            >
              <summary className="cursor-pointer list-none p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/35">
                        <BookOpen className="h-5 w-5 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">{course.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {course.code} • {course.families.length} session
                          {course.families.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {renderMetaBadge(`Present ${course.fullyPresent}`)}
                      {renderMetaBadge(`Partial ${course.partial}`, "muted")}
                      {renderMetaBadge(`Missed ${course.missed}`, "destructive")}
                      {course.flagged > 0
                        ? renderMetaBadge(`Flagged ${course.flagged}`, "destructive")
                        : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
                        course.attendanceRate < 75
                          ? "border-destructive/20 bg-destructive/5 text-destructive"
                          : "border-border bg-muted/40 text-foreground"
                      }`}
                    >
                      {course.attendanceRate}%
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </div>
                </div>
              </summary>

              <div className="border-t border-border/60 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">
                {course.families.length === 0 ? (
                  <div className="rounded-2xl border border-border/70 bg-background/45 p-4 text-sm text-muted-foreground">
                    No class sessions recorded yet for this course.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {course.families.map((entry) => (
                      <article
                        key={entry.familyKey}
                        className="rounded-2xl border border-border/70 bg-background/45 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="font-semibold text-foreground">
                                Week {entry.weekNumber}
                              </span>
                              <span className="text-muted-foreground">•</span>
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {dateFormatter.format(entry.startedAt)}
                              </span>
                              <span className="text-muted-foreground">•</span>
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                {timeFormatter.format(entry.startedAt)}
                              </span>
                            </div>
                          </div>
                          {renderResultBadge(entry)}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {renderPhaseBadge(
                            "Check In",
                            entry.phaseOneDone,
                            entry.phaseOneSessions
                          )}
                          {renderPhaseBadge(
                            "Check Out",
                            entry.phaseTwoDone,
                            entry.phaseTwoSessions
                          )}
                          {entry.flagged
                            ? renderMetaBadge("Flagged Attempt", "destructive")
                            : null}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
