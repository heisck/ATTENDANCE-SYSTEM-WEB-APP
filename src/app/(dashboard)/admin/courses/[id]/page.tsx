import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { CourseEnrollmentManager } from "@/components/course-enrollment-manager";

export default async function AdminCourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as { organizationId?: string | null }).organizationId;
  if (!orgId) redirect("/login");

  const { id } = await params;
  const course = await db.course.findUnique({
    where: { id, organizationId: orgId },
    include: { lecturer: true },
  });

  if (!course) notFound();

  return (
    <CourseEnrollmentManager
      courseId={course.id}
      courseCode={course.code}
      courseName={course.name}
      backHref="/admin/courses"
    />
  );
}
