import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, Users, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";

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
      <PageHeader
        eyebrow="Lecturer"
        title="My Courses"
        description="Manage student enrollments for your courses."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <Link
            key={course.id}
            href={`/lecturer/courses/${course.id}`}
            className="flex items-center justify-between rounded-lg border border-border/70 bg-background/40 p-4 transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">{course.code}</p>
                <p className="text-sm text-muted-foreground">{course.name}</p>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {course._count.enrollments} enrolled
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </Link>
        ))}
      </div>

      {courses.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 font-medium">No courses assigned</p>
          <p className="text-sm text-muted-foreground">
            Contact your administrator to be assigned courses.
          </p>
        </div>
      )}
    </div>
  );
}
