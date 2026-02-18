import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

export default async function OrganizationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const organizations = await db.organization.findMany({
    include: {
      _count: { select: { users: true, courses: true } },
      subscription: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Organizations</h1>
        <p className="text-muted-foreground">
          All universities on the platform
        </p>
      </div>

      <AttendanceTable
        columns={[
          { key: "name", label: "Name" },
          { key: "slug", label: "Code" },
          { key: "domain", label: "Domain" },
          { key: "users", label: "Users" },
          { key: "courses", label: "Courses" },
          { key: "plan", label: "Plan" },
          { key: "created", label: "Created" },
        ]}
        data={organizations.map((org) => ({
          name: org.name,
          slug: org.slug,
          domain: org.domain || "-",
          users: org._count.users,
          courses: org._count.courses,
          plan: org.subscription?.plan || "FREE",
          created: org.createdAt.toLocaleDateString(),
        }))}
      />
    </div>
  );
}
