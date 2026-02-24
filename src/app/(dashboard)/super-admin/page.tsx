import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { StatsGrid, StatCard } from "@/components/dashboard/stats-cards";
import Image from "next/image";
import { Building2, Users, BarChart3 } from "lucide-react";

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
      <section className="surface p-5 sm:p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Platform
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="section-subtitle mt-1">
          Manage all organizations on AttendanceIQ
        </p>
      </section>

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
          icon={<Image src="/web-app-manifest-192x192.png" alt="" width={20} height={20} className="rounded" />}
        />
      </StatsGrid>

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
