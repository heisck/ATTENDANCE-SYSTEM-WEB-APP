import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";

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
      <section className="surface p-4 sm:p-5">
        <p className="section-title">Administration Workspace</p>
        <p className="section-subtitle">Institution metrics and recent session activity.</p>
      </section>

      <OverviewMetrics
        title="Institution Snapshot"
        items={[
          { key: "students", label: "Students", value: students },
          { key: "lecturers", label: "Lecturers", value: lecturers },
          { key: "courses", label: "Courses", value: courses },
          { key: "sessions", label: "Total Sessions", value: sessions },
        ]}
      />

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
