import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { SectionHeading } from "@/components/dashboard/page-header";
import { LecturerCourseSelfAssignPanel } from "@/components/lecturer-course-self-assign-panel";
import { StudentSignupWindowPanel } from "@/components/student-signup-window-panel";

export default async function LecturerCoursesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const courses = await db.course.findMany({
    where: { lecturerId: session.user.id },
    include: { _count: { select: { enrollments: true, sessions: true } } },
    orderBy: { code: "asc" },
  });

  return (
    <div className="space-y-6">
      <LecturerCourseSelfAssignPanel />
      <StudentSignupWindowPanel />

      <section className="space-y-4">
        <SectionHeading title="Assigned Courses" />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <Link
              key={course.id}
              href={`/lecturer/courses/${course.id}`}
              className="group rounded-xl border border-border/70 bg-background/40 p-4 transition-[background-color,border-color,box-shadow,transform] duration-150 hover:bg-muted/40 hover:shadow-sm active:translate-y-px sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-xl bg-primary/10 p-2.5">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <span className="rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Course
                </span>
              </div>
              <div className="mt-4 space-y-1">
                <p className="text-sm font-semibold uppercase tracking-[0.08em] text-primary">
                  {course.code}
                </p>
                <p className="text-base font-semibold leading-tight text-foreground sm:text-lg">
                  {course.name}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-border/70 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">
                  {course._count.enrollments} enrolled
                </span>
                <span className="rounded-full border border-border/70 bg-muted/25 px-2.5 py-1 text-xs text-muted-foreground">
                  {course._count.sessions} sessions
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5 text-sm font-medium text-foreground transition-colors group-hover:bg-muted/40">
                <span>Open course</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {courses.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 font-medium">No courses assigned</p>
          <p className="text-sm text-muted-foreground">
            Use the form above to assign a course to yourself, then open it to add students.
          </p>
        </div>
      )}
    </div>
  );
}
