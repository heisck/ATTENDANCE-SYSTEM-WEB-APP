import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";

export default async function SuperAdminDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [orgs, totalUsers, totalSessions, totalRecords] = await Promise.all([
    db.organization.count(),
    db.user.count(),
    db.attendanceSession.count(),
    db.attendanceRecord.count(),
  ]);

  const organizations = await db.organization.findMany({
    include: {
      _count: { select: { users: true, courses: true } },
      subscription: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <section className="surface p-4 sm:p-5">
        <p className="section-title">Platform Workspace</p>
        <p className="section-subtitle">Tenant management and global system activity.</p>
      </section>

      <OverviewMetrics
        title="Platform Snapshot"
        items={[
          { key: "orgs", label: "Organizations", value: orgs },
          { key: "users", label: "Total Users", value: totalUsers },
          { key: "sessions", label: "Total Sessions", value: totalSessions },
          { key: "records", label: "Attendance Records", value: totalRecords },
        ]}
      />

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="section-title">Organizations</h2>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Tenants and subscription snapshot
          </p>
        </div>
        <div className="space-y-3">
          {organizations.map((org) => (
            <div
              key={org.id}
              className="surface flex items-center justify-between p-4"
            >
              <div>
                <p className="font-medium">{org.name}</p>
                <p className="text-sm text-muted-foreground">
                  {org.slug} &middot; {org.domain || "no domain"}
                </p>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="text-center">
                  <p className="font-medium">{org._count.users}</p>
                  <p className="text-muted-foreground">Users</p>
                </div>
                <div className="text-center">
                  <p className="font-medium">{org._count.courses}</p>
                  <p className="text-muted-foreground">Courses</p>
                </div>
                <span className="rounded-full border border-border bg-muted/45 px-2.5 py-0.5 text-xs font-medium">
                  {org.subscription?.plan || "FREE"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
