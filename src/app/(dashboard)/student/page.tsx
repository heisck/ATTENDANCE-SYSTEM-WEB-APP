import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";
import { redirect } from "next/navigation";
import { StatsGrid, StatCard } from "@/components/dashboard/stats-cards";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { PushNotificationToggle } from "@/components/push-notification-toggle";
import { QrCode, CheckCircle2, AlertTriangle, BookOpen } from "lucide-react";
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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Student Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {session.user.name}
          </p>
        </div>
        <Link
          href="/student/attend"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          <QrCode className="h-4 w-4" />
          Mark Attendance
        </Link>
      </div>

      {!hasCredential && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <div>
              <p className="font-medium text-yellow-800">
                Device not registered
              </p>
              <p className="text-sm text-yellow-700">
                You need to{" "}
                <Link
                  href="/setup-device"
                  className="underline font-medium"
                >
                  register your device
                </Link>{" "}
                before marking attendance.
              </p>
            </div>
          </div>
        </div>
      )}

      <PushNotificationToggle />

      <StatsGrid>
        <StatCard
          title="Enrolled Courses"
          value={enrollments}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          title="Total Attendance"
          value={totalAttendance}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          title="Flagged Records"
          value={flaggedCount}
          subtitle={flaggedCount > 0 ? "Review recommended" : "All clear"}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard
          title="Confidence Avg"
          value={
            recentRecords.length > 0
              ? Math.round(
                  recentRecords.reduce((a, r) => a + r.confidence, 0) /
                    recentRecords.length
                ) + "%"
              : "N/A"
          }
          icon={<QrCode className="h-5 w-5" />}
        />
      </StatsGrid>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Live Attendance Sessions</h2>
        <AttendanceTable
          columns={[
            { key: "course", label: "Course" },
            { key: "phase", label: "Phase" },
            { key: "started", label: "Started" },
            { key: "action", label: "" },
          ]}
          data={liveSessions.map((sessionItem) => ({
            course: `${sessionItem.course.code} - ${sessionItem.course.name}`,
            phase: sessionItem.phase,
            started: sessionItem.startedAt.toLocaleTimeString(),
            action: "Open Scanner",
          }))}
          emptyMessage="No live sessions right now."
        />
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Recent Attendance</h2>
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
            status: r.flagged ? "Flagged" : "Verified",
          }))}
          emptyMessage="No attendance records yet. Mark your first attendance!"
        />
      </div>
    </div>
  );
}
