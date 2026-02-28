import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { PageHeader } from "@/components/dashboard/page-header";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { StudentHubShell } from "@/components/student-hub/student-hub-shell";

export default async function StudentHubUpdatesPage() {
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
          title="Class Updates"
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
          title="Class Updates"
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
  scopeFilters.push({
    AND: [{ cohortId: null }, { courseId: null }],
  });

  const updates = await db.classUpdate.findMany({
    where: {
      organizationId: context.organizationId,
      isActive: true,
      OR: scopeFilters,
    },
    include: {
      course: { select: { code: true, name: true } },
      cohort: { select: { displayName: true } },
    },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  const updateTypeCount = new Set(updates.map((item) => item.type)).size;
  const courseScopedCount = updates.filter((item) => Boolean(item.course)).length;
  const latestEffective = updates[0]?.effectiveAt;

  return (
    <div className="space-y-6">
      <StudentHubShell
        title="Class Updates"
        description="Latest cancellation, reschedule, venue, and notice updates in a richer Student Hub experience."
        activeRoute="updates"
        metrics={[
          { label: "Total Updates", value: String(updates.length) },
          { label: "Update Types", value: String(updateTypeCount) },
          { label: "Course-specific", value: String(courseScopedCount) },
          { label: "Latest Effective", value: latestEffective ? latestEffective.toLocaleDateString() : "None" },
        ]}
      />

      <AttendanceTable
        columns={[
          { key: "type", label: "Type" },
          { key: "title", label: "Title" },
          { key: "course", label: "Course" },
          { key: "cohort", label: "Cohort" },
          { key: "effective", label: "Effective At" },
          { key: "message", label: "Message" },
        ]}
        data={updates.map((update) => ({
          type: update.type,
          title: update.title,
          course: update.course ? `${update.course.code} - ${update.course.name}` : "-",
          cohort: update.cohort?.displayName || "-",
          effective: update.effectiveAt.toLocaleString(),
          message: update.message,
        }))}
        emptyMessage="No updates published yet."
      />
    </div>
  );
}
