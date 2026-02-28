import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { PageHeader } from "@/components/dashboard/page-header";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { StudentHubExperienceBadge } from "@/components/student-hub/student-hub-experience-badge";

export default async function StudentHubExamsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    redirect("/login");
  }

  if (!context.featureFlags.studentHubCore || !context.featureFlags.examHub) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Student Hub"
          title="Exams"
          description="Exam hub is disabled for this organization."
        />
      </div>
    );
  }

  if (!context.organizationId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Student Hub"
          title="Exams"
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

  const exams =
    scopeFilters.length === 0
      ? []
      : await db.examEntry.findMany({
          where: {
            organizationId: context.organizationId,
            OR: scopeFilters,
          },
          include: {
            course: { select: { code: true, name: true } },
            cohort: { select: { displayName: true } },
            attachments: true,
            updates: { orderBy: { effectiveAt: "desc" }, take: 3 },
          },
          orderBy: { examDate: "asc" },
          take: 150,
        });
  const now = new Date();
  const searchableCount = exams.filter((exam) =>
    exam.attachments.some((attachment) => attachment.mime.toLowerCase().includes("pdf")),
  ).length;
  const upcomingCount = exams.filter((exam) => new Date(exam.examDate).getTime() >= now.getTime()).length;

  return (
    <div className="space-y-6">
      <StudentHubExperienceBadge />

      <section className="surface grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Exam Entries</p>
          <p className="mt-1 text-lg font-semibold">{exams.length}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Upcoming Exams</p>
          <p className="mt-1 text-lg font-semibold">{upcomingCount}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">PDF Search Ready</p>
          <p className="mt-1 text-lg font-semibold">{searchableCount}</p>
        </div>
      </section>

      <AttendanceTable
        columns={[
          { key: "course", label: "Course" },
          { key: "title", label: "Title" },
          { key: "examDate", label: "Exam Date" },
          { key: "venue", label: "Venue" },
          { key: "attachments", label: "Attachments" },
          { key: "updates", label: "Latest Update" },
          { key: "search", label: "PDF Search" },
        ]}
        data={exams.map((exam) => ({
          course: exam.course ? `${exam.course.code} - ${exam.course.name}` : exam.cohort?.displayName || "-",
          title: exam.title,
          examDate: new Date(exam.examDate).toLocaleString(),
          venue: exam.allowAnyHall ? "Any listed hall" : exam.venue || "-",
          attachments: exam.attachments.length,
          updates: exam.updates[0]?.message || "-",
          search: exam.attachments.some((attachment) => attachment.mime.toLowerCase().includes("pdf")) ? (
            <Link
              href={`/student/hub/exams/search?examId=${encodeURIComponent(exam.id)}`}
              className="text-xs underline underline-offset-2"
            >
              Search PDF
            </Link>
          ) : (
            "-"
          ),
        }))}
        emptyMessage="No exam entries found for your cohort/courses."
      />
    </div>
  );
}
