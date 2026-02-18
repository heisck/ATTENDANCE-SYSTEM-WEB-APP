import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { StatsGrid, StatCard } from "@/components/dashboard/stats-cards";
import { Building2, Users, BarChart3, Shield } from "lucide-react";

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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Platform Overview</h1>
        <p className="text-muted-foreground">
          Manage all organizations on AttendanceIQ
        </p>
      </div>

      <StatsGrid>
        <StatCard
          title="Organizations"
          value={orgs}
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          title="Total Users"
          value={totalUsers}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Total Sessions"
          value={totalSessions}
          icon={<BarChart3 className="h-5 w-5" />}
        />
        <StatCard
          title="Attendance Records"
          value={totalRecords}
          icon={<Shield className="h-5 w-5" />}
        />
      </StatsGrid>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Organizations</h2>
        <div className="space-y-3">
          {organizations.map((org) => (
            <div
              key={org.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
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
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {org.subscription?.plan || "FREE"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
