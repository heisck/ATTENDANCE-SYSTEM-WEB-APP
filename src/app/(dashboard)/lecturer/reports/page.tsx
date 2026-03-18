import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { PageHeader } from "@/components/dashboard/page-header";

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
        <div key={course.id} className="space-y-3">
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/40 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                {course.code} - {course.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {course._count.enrollments} enrolled &middot;{" "}
                {course._count.sessions} sessions
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Full attendance counts only when a student completes both Phase 1 and Phase 2 on the same class day.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/reports/export?courseId=${course.id}&format=csv`}
                className="inline-flex items-center rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Course CSV
              </a>
              <a
                href={`/api/reports/export?courseId=${course.id}&format=xlsx`}
                className="inline-flex items-center rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Course Excel
              </a>
              <a
                href={`/api/reports/export?courseId=${course.id}&format=pdf`}
                className="inline-flex items-center rounded-md border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Course PDF
              </a>
            </div>
          </div>
          <AttendanceTable
            columns={[
              { key: "date", label: "Session Date" },
              { key: "phase", label: "Phase" },
              { key: "attendance", label: "Students Marked" },
              { key: "status", label: "Status" },
              { key: "export", label: "Export" },
            ]}
            data={course.sessions.map((s) => ({
              date: s.startedAt.toLocaleDateString(),
              phase: phaseLabel(s.phase),
              attendance: `${s._count.records} / ${course._count.enrollments}`,
              status: s.status,
              export: (
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/reports/export?sessionId=${s.id}&format=csv`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    CSV
                  </a>
                  <a
                    href={`/api/reports/export?sessionId=${s.id}&format=xlsx`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Excel
                  </a>
                  <a
                    href={`/api/reports/export?sessionId=${s.id}&format=pdf`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    PDF
                  </a>
                </div>
              ),
            }))}
            emptyMessage="No sessions recorded yet."
          />
        </div>
      ))}

      {courses.length === 0 && (
        <p className="text-muted-foreground">No courses assigned yet.</p>
      )}
    </div>
  );
}
