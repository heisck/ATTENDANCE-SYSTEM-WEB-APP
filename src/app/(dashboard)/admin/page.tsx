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
    <div className="space-y-6">
      <section className="surface p-5 sm:p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Administration
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">University Overview</h1>
        <p className="section-subtitle mt-1">
          Manage your university&apos;s attendance system
        </p>
      </section>

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

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="section-title">Recent Activity</h2>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Latest sessions across your institution
          </p>
        </div>
        <div className="space-y-3">
          {recentActivity.map((s) => (
            <div
              key={s.id}
              className="surface flex items-center justify-between p-4"
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
                      ? "border border-border bg-muted/40 text-foreground"
                      : "border border-border bg-muted/70 text-muted-foreground"
                  }`}
                >
                  {s.status}
                </span>
              </div>
            </div>
          ))}
          {recentActivity.length === 0 && (
            <div className="surface p-5 text-sm text-muted-foreground">No activity yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
