import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { PageHeader, SectionHeading } from "@/components/dashboard/page-header";

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
      <PageHeader
        eyebrow="Admin"
        title="Administration Workspace"
        description="Institution metrics and recent session activity."
      />

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
        <SectionHeading title="Recent Activity" description="Latest sessions across your institution" />
        <div className="space-y-3">
          {recentActivity.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-lg border border-border/70 bg-background/40 p-4"
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
            <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
              No activity yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
