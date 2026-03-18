import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { LecturerCourseReportCard } from "@/components/lecturer-course-report-card";

function phaseLabel(phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED") {
  if (phase === "PHASE_ONE") return "Phase 1";
  if (phase === "PHASE_TWO") return "Phase 2";
  return "Closed";
}

export default async function LecturerReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const courses = await db.course.findMany({
    where: { lecturerId: session.user.id },
    include: {
      _count: { select: { sessions: true, enrollments: true } },
      sessions: {
        include: { _count: { select: { records: true } } },
        orderBy: { startedAt: "desc" },
        take: 5,
      },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lecturer"
        title="Reports"
        description="Export attendance by full course summary or by individual class session."
      />

      {courses.map((course) => (
        <LecturerCourseReportCard
          key={course.id}
          courseId={course.id}
          courseCode={course.code}
          courseName={course.name}
          enrollmentCount={course._count.enrollments}
          sessionCount={course._count.sessions}
          sessions={course.sessions.map((session) => ({
            id: session.id,
            dateLabel: session.startedAt.toLocaleDateString(),
            phaseLabel: phaseLabel(session.phase),
            attendanceLabel: `${session._count.records} / ${course._count.enrollments}`,
            status: session.status,
          }))}
        />
      ))}

      {courses.length === 0 && (
        <p className="text-muted-foreground">No courses assigned yet.</p>
      )}
    </div>
  );
}
