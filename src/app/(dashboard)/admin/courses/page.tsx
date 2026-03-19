import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { CoursesTablePanel } from "@/components/admin/courses-table-panel";

export default async function AdminCoursesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId;
  if (!orgId) redirect("/login");

  const courses = await db.course.findMany({
    where: { organizationId: orgId },
    include: {
      lecturer: true,
      _count: { select: { enrollments: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <CoursesTablePanel
        rows={courses.map((course) => ({
          id: course.id,
          code: course.code,
          name: course.name,
          lecturer: course.lecturer.name,
          students: course._count.enrollments,
        }))}
      />
    </div>
  );
}
