import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

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
      <div>
        <h1 className="text-2xl font-bold">Courses</h1>
        <p className="text-muted-foreground">
          All courses in your university
        </p>
      </div>

      <AttendanceTable
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "lecturer", label: "Lecturer" },
          { key: "students", label: "Students" },
          { key: "sessions", label: "Sessions" },
        ]}
        data={courses.map((c) => ({
          code: c.code,
          name: c.name,
          lecturer: c.lecturer.name,
          students: c._count.enrollments,
          sessions: c._count.sessions,
        }))}
        emptyMessage="No courses created yet."
      />
    </div>
  );
}
