import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ClassDetailPanel } from "@/components/admin/class-detail-panel";
import { getEffectiveFeatureFlags } from "@/lib/organization-settings";

export default async function AdminClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId as string | null;
  if (!orgId) redirect("/login");

  const { id } = await params;
  const classGroup = await db.cohort.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!classGroup) notFound();

  const organization = await db.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const initialFeatureFlags = getEffectiveFeatureFlags(organization?.settings, classGroup.id);

  const [students, courseRepScopes] = await Promise.all([
    db.user.findMany({
      where: {
        organizationId: orgId,
        role: "STUDENT",
        cohortId: id,
      },
      include: {
        _count: {
          select: {
            attendances: true,
            enrollments: true,
          },
        },
      },
      orderBy: [{ name: "asc" }],
    }),
    db.courseRepScope.findMany({
      where: {
        organizationId: orgId,
        cohortId: id,
      },
      include: {
        user: {
          select: { name: true, email: true },
        },
        course: {
          select: { code: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return (
    <ClassDetailPanel
      classGroupId={classGroup.id}
      classGroupName={classGroup.displayName}
      initialFeatureFlags={initialFeatureFlags}
      students={students.map((student) => ({
        name: student.name,
        indexNumber: student.indexNumber || student.studentId || "-",
        institutionEmail: student.email,
        registeredCourses: student._count.enrollments,
        attendanceRecords: student._count.attendances,
      }))}
      courseReps={courseRepScopes.map((scope) => ({
        rep: scope.user ? `${scope.user.name} (${scope.user.email})` : scope.userId,
        scope: scope.course ? `${scope.course.code} - ${scope.course.name}` : classGroup.displayName,
        status: scope.active ? "Enabled" : "Disabled",
        assignedAt: scope.createdAt.toLocaleString(),
      }))}
    />
  );
}
