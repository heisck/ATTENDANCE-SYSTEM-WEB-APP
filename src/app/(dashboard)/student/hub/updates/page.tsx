import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { PageHeader } from "@/components/dashboard/page-header";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { StudentHubExperienceBadge } from "@/components/student-hub/student-hub-experience-badge";

type UpdatesPageProps = {
  searchParams?: {
    type?: string;
    course?: string;
  };
};

export default async function StudentHubUpdatesPage({ searchParams }: UpdatesPageProps) {
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

  const scopedUpdates = await db.classUpdate.findMany({
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
    take: 200,
  });

  const selectedType =
    typeof searchParams?.type === "string" && searchParams.type.trim().length > 0 ? searchParams.type : "ALL";
  const selectedCourse =
    typeof searchParams?.course === "string" && searchParams.course.trim().length > 0 ? searchParams.course : "ALL";

  const updates = scopedUpdates.filter((update) => {
    if (selectedType !== "ALL" && update.type !== selectedType) return false;
    if (selectedCourse !== "ALL" && update.courseId !== selectedCourse) return false;
    return true;
  });

  const typeOptions = Array.from(new Set(scopedUpdates.map((update) => update.type))).sort();
  const courseOptions = Array.from(
    new Map(
      scopedUpdates
        .filter((update) => Boolean(update.courseId))
        .map((update) => [
          update.courseId!,
          {
            id: update.courseId!,
            label: update.course ? `${update.course.code} - ${update.course.name}` : "Unknown course",
          },
        ]),
    ).values(),
  );

  return (
    <div className="min-w-0 space-y-6">
      <StudentHubExperienceBadge />

      <section className="surface grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Total Updates</p>
          <p className="mt-1 text-lg font-semibold">{scopedUpdates.length}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Showing</p>
          <p className="mt-1 text-lg font-semibold">{updates.length}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Filters</p>
          <p className="mt-1 break-words text-sm font-medium text-muted-foreground">
            {selectedType === "ALL" ? "All types" : selectedType}
            {" · "}
            {selectedCourse === "ALL"
              ? "All courses"
              : courseOptions.find((course) => course.id === selectedCourse)?.label || "Selected course"}
          </p>
        </div>
      </section>

      <form method="get" className="surface grid gap-3 p-4 sm:flex sm:flex-wrap sm:items-end">
        <label className="min-w-0 space-y-1 text-sm">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Update Type</span>
          <select
            name="type"
            defaultValue={selectedType}
            className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm sm:min-w-52"
          >
            <option value="ALL">All Types</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Course</span>
          <select
            name="course"
            defaultValue={selectedCourse}
            className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm sm:min-w-64"
          >
            <option value="ALL">All Courses</option>
            {courseOptions.map((course) => (
              <option key={course.id} value={course.id}>
                {course.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent sm:w-auto"
        >
          Apply Filters
        </button>
      </form>

      <section className="space-y-3 sm:hidden">
        {updates.length === 0 ? (
          <div className="surface p-4 text-sm text-muted-foreground">No updates published yet.</div>
        ) : (
          updates.map((update) => (
            <article key={update.id} className="surface space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold text-foreground">{update.title}</p>
                <span className="inline-flex rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {update.type}
                </span>
              </div>
              <p className="text-sm text-foreground/90">
                {update.course
                  ? `${update.course.code} - ${update.course.name}${update.cohort?.displayName ? ` (${update.cohort.displayName})` : ""}`
                  : update.cohort?.displayName || "-"}
              </p>
              <p className="text-xs text-muted-foreground">{update.effectiveAt.toLocaleString()}</p>
              <p className="break-words text-sm text-foreground/90">{update.message}</p>
            </article>
          ))
        )}
      </section>

      <div className="hidden sm:block">
        <AttendanceTable
          columns={[
            { key: "type", label: "Type" },
            { key: "title", label: "Title" },
            { key: "course", label: "Course" },
            { key: "effective", label: "Effective At" },
            { key: "message", label: "Message" },
          ]}
          data={updates.map((update) => ({
            type: update.type,
            title: update.title,
            course: update.course
              ? `${update.course.code} - ${update.course.name}${update.cohort?.displayName ? ` (${update.cohort.displayName})` : ""}`
              : update.cohort?.displayName || "-",
            effective: update.effectiveAt.toLocaleString(),
            message: update.message,
          }))}
          emptyMessage="No updates published yet."
        />
      </div>
    </div>
  );
}
