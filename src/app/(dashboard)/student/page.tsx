import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";
import { deriveAttendancePhase } from "@/lib/attendance";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { SectionHeading } from "@/components/dashboard/page-header";
import { StudentLiveSessionsTable } from "@/components/dashboard/student-live-sessions-table";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { getStudentHubContext } from "@/lib/student-hub";
import { getStudentPhaseCompletionForCourseDay } from "@/lib/phase-completion";
import { getHistoricalPhaseFromSession, resolveSessionFamilyKey } from "@/lib/session-flow";

export default async function StudentDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;
  const gate = await getStudentGateState(userId);
  if (gate.redirectPath) redirect(gate.redirectPath);

  const now = new Date();

  const [enrollments, attendedSessions, flaggedCount, recentRecords, liveSessions] =
    await Promise.all([
      db.enrollment.count({ where: { studentId: userId } }),
      db.attendanceSession.findMany({
        where: {
          records: {
            some: { studentId: userId },
          },
        },
        select: {
          courseId: true,
          lecturerId: true,
          sessionFamilyId: true,
          sessionFlow: true,
          phase: true,
          startedAt: true,
        },
      }),
      db.attendanceRecord.count({
        where: { studentId: userId, flagged: true },
      }),
      db.attendanceRecord.findMany({
        where: { studentId: userId },
        include: {
          session: { include: { course: true } },
        },
        orderBy: { markedAt: "desc" },
        take: 10,
      }),
      db.attendanceSession.findMany({
        where: {
          status: "ACTIVE",
          endsAt: { gt: now },
          course: {
            enrollments: {
              some: { studentId: userId },
            },
          },
        },
        select: {
          id: true,
          status: true,
          phase: true,
          startedAt: true,
          endsAt: true,
          course: { select: { code: true, name: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);

  const attendanceFamilies = new Map<
    string,
    {
      phaseOneDone: boolean;
      phaseTwoDone: boolean;
    }
  >();

  for (const sessionItem of attendedSessions) {
    const familyKey = resolveSessionFamilyKey({
      sessionFamilyId: sessionItem.sessionFamilyId,
      courseId: sessionItem.courseId,
      lecturerId: sessionItem.lecturerId,
      startedAt: sessionItem.startedAt,
    });
    const current = attendanceFamilies.get(familyKey) ?? {
      phaseOneDone: false,
      phaseTwoDone: false,
    };
    const historicalPhase = getHistoricalPhaseFromSession({
      sessionFlow: sessionItem.sessionFlow,
      phase: sessionItem.phase,
    });

    if (historicalPhase === "PHASE_ONE") {
      current.phaseOneDone = true;
    }
    if (historicalPhase === "PHASE_TWO") {
      current.phaseTwoDone = true;
    }

    attendanceFamilies.set(familyKey, current);
  }

  const totalAttendance = Array.from(attendanceFamilies.values()).filter(
    (entry) => entry.phaseOneDone && entry.phaseTwoDone
  ).length;

  const initialLiveSessions = liveSessions
    .map((sessionItem) => ({
      id: sessionItem.id,
      phase: deriveAttendancePhase(
        {
          status: sessionItem.status,
          phase: sessionItem.phase,
          endsAt: sessionItem.endsAt,
        },
        now
      ),
      startedAt: sessionItem.startedAt.toISOString(),
      course: {
        code: sessionItem.course.code,
        name: sessionItem.course.name,
      },
    }))
    .filter((sessionItem) => sessionItem.phase !== "CLOSED");

  const hasCredential = await db.webAuthnCredential.count({
    where: { userId },
  });

  const recentPhaseCompletion = await Promise.all(
    recentRecords.map((record) =>
      getStudentPhaseCompletionForCourseDay({
        studentId: userId,
        sessionFamilyId: record.session.sessionFamilyId,
        courseId: record.session.courseId,
        lecturerId: record.session.lecturerId,
        referenceTime: record.session.startedAt,
      })
    )
  );

  const hubContext = await getStudentHubContext(userId);
  const studentHubAccess = hubContext?.hubAccess;
  const studentHubLocked = Boolean(studentHubAccess && !studentHubAccess.accessAllowed);

  return (
    <div className="space-y-6">
      {!hasCredential && (
        <section className="surface-muted p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-foreground/70" />
            <div>
              <p className="text-sm font-medium">Device not registered</p>
              <p className="mt-1 text-sm text-muted-foreground">
                You need to{" "}
                <Link href="/setup-device" className="font-medium text-foreground underline underline-offset-2">
                  register your device
                </Link>{" "}
                before marking attendance.
              </p>
            </div>
          </div>
        </section>
      )}

      {studentHubLocked && studentHubAccess?.reason === "TRIAL_EXPIRED_UNPAID" ? (
        <section className="surface-muted p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-foreground/70" />
            <div>
              <p className="text-sm font-medium">Student Hub is locked for this organization</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Free trial has ended and payment is required (
                {studentHubAccess.paymentCurrency} {studentHubAccess.paymentAmount}). Attendance remains active.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <OverviewMetrics
        title="Attendance Snapshot"
        compact
        showTopBorder={false}
        items={[
          { key: "courses", label: "Enrolled Courses", value: enrollments },
          { key: "attendance", label: "Total Attendance", value: totalAttendance },
          {
            key: "flagged",
            label: "Flagged Records",
            value: flaggedCount,
            hint: flaggedCount > 0 ? "Review recommended" : "All clear",
          },
          {
            key: "confidence",
            label: "Confidence Avg",
            value:
              recentRecords.length > 0
                ? Math.round(
                    recentRecords.reduce((a, r) => a + r.confidence, 0) /
                      recentRecords.length
                  ) + "%"
                : "N/A",
          },
        ]}
      />

      <section className="space-y-3">
        <SectionHeading
          title="Live Attendance Sessions"
          description="Real-time sessions available for check-in"
        />
        <StudentLiveSessionsTable initialSessions={initialLiveSessions} />
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Recent Attendance"
          description="Your latest verification records"
        />
        <AttendanceTable
          columns={[
            { key: "course", label: "Course" },
            { key: "date", label: "Date" },
            { key: "confidence", label: "Confidence" },
            { key: "status", label: "Status" },
          ]}
          data={recentRecords.map((r, index) => {
            const phaseState = recentPhaseCompletion[index];
            const statusText = r.flagged
              ? "Flagged"
              : phaseState?.overallPresent
                ? "Present (Phase 1 + 2)"
                : phaseState?.pendingPhase === "PHASE_TWO"
                  ? "Phase 1 Done (Pending Phase 2)"
                  : phaseState?.pendingPhase === "PHASE_ONE"
                    ? "Phase 1 Missing"
                    : "Recorded";

            return {
              course: `${r.session.course.code} - ${r.session.course.name}`,
              date: r.markedAt.toLocaleDateString(),
              confidence: `${r.confidence}%`,
              status: r.flagged ? (
                <span className="inline-flex rounded-full border border-border bg-muted/70 px-2 py-0.5 text-xs font-medium">
                  Flagged
                </span>
              ) : statusText === "Present (Phase 1 + 2)" ? (
                <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  Present (Phase 1 + 2)
                </span>
              ) : statusText === "Phase 1 Done (Pending Phase 2)" ? (
                <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  Phase 1 Done
                </span>
              ) : statusText === "Phase 1 Missing" ? (
                <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  Phase 1 Missing
                </span>
              ) : (
                <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  Recorded
                </span>
              ),
            };
          })}
          emptyMessage="No attendance records yet. Mark your first attendance!"
        />
      </section>
    </div>
  );
}
