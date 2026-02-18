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
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lecturer Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {session.user.name}
          </p>
        </div>
        <Link
          href="/lecturer/session/new"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
        >
          <Play className="h-4 w-4" />
          Start Session
        </Link>
      </div>

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

      <div>
        <h2 className="mb-4 text-lg font-semibold">Recent Sessions</h2>
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
            status: s.status === "ACTIVE" ? "Active" : "Closed",
            action:
              s.status === "ACTIVE"
                ? `<a href="/lecturer/session/${s.id}">Monitor</a>`
                : "",
          }))}
          emptyMessage="No sessions yet. Start your first attendance session!"
        />
      </div>
    </div>
  );
}
