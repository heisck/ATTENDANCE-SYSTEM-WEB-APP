import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { StatsGrid, StatCard } from "@/components/dashboard/stats-cards";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { BookOpen, Users, Play, BarChart3 } from "lucide-react";
import Link from "next/link";

export default async function LecturerDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;

  const [courses, activeSessions, totalStudents, recentSessions] =
    await Promise.all([
      db.course.count({ where: { lecturerId: userId } }),
      db.attendanceSession.count({
        where: { lecturerId: userId, status: "ACTIVE" },
      }),
      db.enrollment.count({
        where: { course: { lecturerId: userId } },
      }),
      db.attendanceSession.findMany({
        where: { lecturerId: userId },
        include: {
          course: true,
          _count: { select: { records: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);

  return (
    <div className="space-y-6">
      <section className="surface p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Lecturer
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="section-subtitle mt-1">Welcome back, {session.user.name}</p>
          </div>
          <Link
            href="/lecturer/session/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Play className="h-4 w-4" />
            Start Session
          </Link>
        </div>
      </section>

      <StatsGrid>
        <StatCard
          title="My Courses"
          value={courses}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          title="Active Sessions"
          value={activeSessions}
          icon={<Play className="h-5 w-5" />}
        />
        <StatCard
          title="Total Students"
          value={totalStudents}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Sessions This Month"
          value={recentSessions.filter(
            (s) =>
              s.startedAt.getMonth() === new Date().getMonth() &&
              s.startedAt.getFullYear() === new Date().getFullYear()
          ).length}
          icon={<BarChart3 className="h-5 w-5" />}
        />
      </StatsGrid>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="section-title">Recent Sessions</h2>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Latest class sessions and attendance counts
          </p>
        </div>
        <AttendanceTable
          columns={[
            { key: "course", label: "Course" },
            { key: "date", label: "Date" },
            { key: "students", label: "Students Marked" },
            { key: "status", label: "Status" },
            { key: "action", label: "" },
          ]}
          data={recentSessions.map((s) => ({
            course: `${s.course.code} - ${s.course.name}`,
            date: s.startedAt.toLocaleDateString(),
            students: s._count.records,
            status:
              s.status === "ACTIVE" ? (
                <span className="inline-flex rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">
                  Active
                </span>
              ) : (
                <span className="inline-flex rounded-full border border-border bg-muted/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Closed
                </span>
              ),
            action:
              s.status === "ACTIVE"
                ? (
                  <Link
                    href={`/lecturer/session/${s.id}`}
                    className="text-xs font-medium text-foreground underline underline-offset-2"
                  >
                    Monitor
                  </Link>
                )
                : (
                  <span className="text-xs text-muted-foreground">-</span>
                ),
          }))}
          emptyMessage="No sessions yet. Start your first attendance session!"
        />
      </section>
    </div>
  );
}
