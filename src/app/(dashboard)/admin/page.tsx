import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import { DashboardCourseRegistrationsPanel } from "@/components/admin/dashboard-course-registrations-panel";

export default async function AdminDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId;
  if (!orgId) redirect("/login");

  const [students, lecturers, courses, courseEnrollmentSummary] = await Promise.all([
    db.user.count({ where: { organizationId: orgId, role: "STUDENT" } }),
    db.user.count({ where: { organizationId: orgId, role: "LECTURER" } }),
    db.course.count({ where: { organizationId: orgId } }),
    db.course.findMany({
      where: { organizationId: orgId },
      include: {
        lecturer: { select: { name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: [{ enrollments: { _count: "desc" } }, { code: "asc" }],
      take: 150,
    }),
  ]);

  return (
    <div className="space-y-6">
      <OverviewMetrics
        title="Admin Snapshot"
        compact
        showTopBorder={false}
        items={[
          { key: "courses", label: "Registered Courses", value: courses },
          { key: "lecturers", label: "Registered Lecturers", value: lecturers },
          { key: "students", label: "Registered Students", value: students },
        ]}
      />

      <DashboardCourseRegistrationsPanel
        rows={courseEnrollmentSummary.map((course) => ({
          course: `${course.code} - ${course.name}`,
          lecturer: course.lecturer?.name || "Not assigned",
          students: course._count.enrollments,
        }))}
      />
    </div>
  );
}
