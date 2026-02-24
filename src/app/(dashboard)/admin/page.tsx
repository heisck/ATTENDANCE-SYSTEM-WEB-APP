import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { StatsGrid, StatCard } from "@/components/dashboard/stats-cards";
import { Users, BookOpen, BarChart3 } from "lucide-react";

export default async function AdminDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId;
  if (!orgId) redirect("/login");

  const [students, lecturers, courses, sessions] = await Promise.all([
    db.user.count({ where: { organizationId: orgId, role: "STUDENT" } }),
    db.user.count({ where: { organizationId: orgId, role: "LECTURER" } }),
    db.course.count({ where: { organizationId: orgId } }),
    db.attendanceSession.count({
      where: { course: { organizationId: orgId } },
    }),
  ]);

  const recentActivity = await db.attendanceSession.findMany({
    where: { course: { organizationId: orgId } },
    include: {
      course: true,
      lecturer: true,
      _count: { select: { records: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">University Admin</h1>
        <p className="text-muted-foreground">
          Manage your university&apos;s attendance system
        </p>
      </div>

      <StatsGrid>
        <StatCard
          title="Students"
          value={students}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Lecturers"
          value={lecturers}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Courses"
          value={courses}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          title="Total Sessions"
          value={sessions}
          icon={<BarChart3 className="h-5 w-5" />}
        />
      </StatsGrid>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Recent Activity</h2>
        <div className="space-y-3">
          {recentActivity.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
            >
              <div>
                <p className="font-medium">
                  {s.course.code} - {s.course.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {s.lecturer.name} &middot; {s.startedAt.toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">
                  {s._count.records} students
                </p>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.status === "ACTIVE"
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {s.status}
                </span>
              </div>
            </div>
          ))}
          {recentActivity.length === 0 && (
            <p className="text-muted-foreground">No activity yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
