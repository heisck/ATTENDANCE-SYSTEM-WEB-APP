import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { ClassGroupsTablePanel } from "@/components/admin/class-groups-table-panel";

export default async function AdminClassesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId as string | null;
  if (!orgId) redirect("/login");

  const classGroups = await db.cohort.findMany({
    where: { organizationId: orgId },
    include: {
      _count: { select: { users: true, courseRepScopes: true } },
    },
    orderBy: [{ department: "asc" }, { level: "asc" }, { groupCode: "asc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader description="View each class group and open detailed student breakdown." />
      <ClassGroupsTablePanel
        rows={classGroups.map((group) => ({
          id: group.id,
          displayName: group.displayName,
          students: group._count.users,
          courseReps: group._count.courseRepScopes,
        }))}
      />
    </div>
  );
}
