import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { PageHeader } from "@/components/dashboard/page-header";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { StudentHubExperienceBadge } from "@/components/student-hub/student-hub-experience-badge";

function formatDueDelta(dueAt: Date) {
  const now = Date.now();
  const diffMs = Math.max(dueAt.getTime() - now, 0);
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  if (days > 0) return `${days}d ${totalHours % 24}h`;
  if (totalHours > 0) return `${totalHours}h ${totalMinutes % 60}m`;
  return `${totalMinutes}m`;
}

export default async function StudentHubDeadlinesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    redirect("/login");
  }

  if (!context.featureFlags.studentHubCore) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Student Hub"
          title="Deadlines"
          description="Student Hub is disabled for this organization."
        />
      </div>
    );
  }

  if (!context.organizationId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Student Hub"
          title="Deadlines"
          description="No organization context found for this account."
        />
      </div>
    );
  }

  const scopeFilters: Array<Record<string, any>> = [];
  if (context.cohortId) {
    scopeFilters.push({ cohortId: context.cohortId });
  }
  if (context.enrolledCourseIds.length > 0) {
    scopeFilters.push({ courseId: { in: context.enrolledCourseIds } });
  }

  const now = new Date();
  const assignments =
    scopeFilters.length === 0
      ? []
      : await db.assignmentAnnouncement.findMany({
          where: {
            organizationId: context.organizationId,
            OR: scopeFilters,
            dueAt: { gte: now },
          },
          include: {
            course: { select: { code: true, name: true } },
            cohort: { select: { displayName: true } },
            attachments: { select: { id: true } },
          },
          orderBy: { dueAt: "asc" },
          take: 100,
        });
  const dueWithin48Hours = assignments.filter(
    (assignment) => assignment.dueAt.getTime() - now.getTime() <= 48 * 60 * 60 * 1000,
  ).length;

  return (
    <div className="space-y-6">
      <StudentHubExperienceBadge />

      <section className="surface grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Upcoming Deadlines</p>
          <p className="mt-1 text-lg font-semibold">{assignments.length}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Due in 48 Hours</p>
          <p className="mt-1 text-lg font-semibold">{Math.max(dueWithin48Hours, 0)}</p>
        </div>
      </section>

      <AttendanceTable
        columns={[
          { key: "title", label: "Assignment" },
          { key: "course", label: "Course" },
          { key: "cohort", label: "Cohort" },
          { key: "dueAt", label: "Due At" },
          { key: "timeLeft", label: "Time Left" },
          { key: "files", label: "Files" },
        ]}
        data={assignments.map((assignment) => ({
          title: assignment.title,
          course: assignment.course ? `${assignment.course.code} - ${assignment.course.name}` : "-",
          cohort: assignment.cohort?.displayName || "-",
          dueAt: assignment.dueAt.toLocaleString(),
          timeLeft: formatDueDelta(assignment.dueAt),
          files: assignment.attachments.length,
        }))}
        emptyMessage="No upcoming deadlines."
      />
    </div>
  );
}
