import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { PageHeader, SectionHeading } from "@/components/dashboard/page-header";
import { PushNotificationToggle } from "@/components/push-notification-toggle";
import { QrCode, AlertTriangle } from "lucide-react";
import Link from "next/link";

export default async function StudentDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;
  const gate = await getStudentGateState(userId);
  if (gate.redirectPath) redirect(gate.redirectPath);

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
          course: {
            enrollments: {
              some: { studentId: userId },
            },
          },
        },
        include: {
          course: { select: { code: true, name: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);

  const hasCredential = await db.webAuthnCredential.count({
    where: { userId },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Student"
        title="Student Workspace"
        description="Attendance tracking and verification status in one place."
        action={
          <Link
            href="/student/attend"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <QrCode className="h-4 w-4" />
            Mark Attendance
          </Link>
        }
      />

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

      <PushNotificationToggle />

      <OverviewMetrics
        title="Attendance Snapshot"
        compact
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
        <AttendanceTable
          columns={[
            { key: "course", label: "Course" },
            { key: "phase", label: "Phase" },
            { key: "started", label: "Started" },
            { key: "action", label: "" },
          ]}
          data={liveSessions.map((sessionItem) => ({
            course: `${sessionItem.course.code} - ${sessionItem.course.name}`,
            phase: (
              <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs font-medium">
                {sessionItem.phase}
              </span>
            ),
            started: sessionItem.startedAt.toLocaleTimeString(),
            action: (
              <Link href="/student/attend" className="text-xs font-medium text-foreground underline underline-offset-2">
                Open Scanner
              </Link>
            ),
          }))}
          emptyMessage="No live sessions right now."
        />
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
