import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { PageHeader } from "@/components/dashboard/page-header";

export default async function AdminCoursesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId;
  if (!orgId) redirect("/login");

  const courses = await db.course.findMany({
    where: { organizationId: orgId },
    include: {
      lecturer: true,
      _count: { select: { enrollments: true, sessions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Courses"
        description="All courses in your university. Manage enrollments to add or remove students."
      />

      <AttendanceTable
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "lecturer", label: "Lecturer" },
          { key: "students", label: "Students" },
          { key: "sessions", label: "Sessions" },
          { key: "manage", label: "" },
        ]}
        data={courses.map((c) => ({
          code: c.code,
          name: c.name,
          lecturer: c.lecturer.name,
          students: c._count.enrollments,
          sessions: c._count.sessions,
          manage: (
            <Link
              href={`/admin/courses/${c.id}`}
              className="text-primary hover:underline text-sm font-medium"
            >
              Manage enrollments
            </Link>
          ),
        }))}
        emptyMessage="No courses created yet."
      />
    </div>
  );
}
