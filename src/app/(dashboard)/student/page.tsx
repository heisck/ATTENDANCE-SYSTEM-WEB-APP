import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";
import { TOTAL_SESSION_MS, deriveAttendancePhase } from "@/lib/attendance";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { SectionHeading } from "@/components/dashboard/page-header";
import { StudentLiveSessionsTable } from "@/components/dashboard/student-live-sessions-table";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { getStudentHubContext } from "@/lib/student-hub";

export default async function StudentDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;
  const gate = await getStudentGateState(userId);
  if (gate.redirectPath) redirect(gate.redirectPath);

  const now = new Date();
  const activeWindowStart = new Date(now.getTime() - TOTAL_SESSION_MS);

  const [enrollments, totalAttendance, flaggedCount, recentRecords, liveSessions] =
    await Promise.all([
      db.enrollment.count({ where: { studentId: userId } }),
      db.attendanceRecord.count({ where: { studentId: userId } }),
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
          startedAt: { gt: activeWindowStart },
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
          initialEndsAt: true,
          reverifyEndsAt: true,
          course: { select: { code: true, name: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);

  const initialLiveSessions = liveSessions
    .map((sessionItem) => ({
      id: sessionItem.id,
      phase: deriveAttendancePhase(
        {
          status: sessionItem.status,
          startedAt: sessionItem.startedAt,
          initialEndsAt: sessionItem.initialEndsAt,
          reverifyEndsAt: sessionItem.reverifyEndsAt,
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
          data={recentRecords.map((r) => ({
            course: `${r.session.course.code} - ${r.session.course.name}`,
            date: r.markedAt.toLocaleDateString(),
            confidence: `${r.confidence}%`,
            status: r.flagged ? (
              <span className="inline-flex rounded-full border border-border bg-muted/70 px-2 py-0.5 text-xs font-medium">
                Flagged
              </span>
            ) : (
              <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                Verified
              </span>
            ),
          }))}
          emptyMessage="No attendance records yet. Mark your first attendance!"
        />
      </section>
    </div>
  );
}
