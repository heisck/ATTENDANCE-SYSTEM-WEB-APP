import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { StatsGrid, StatCard } from "@/components/dashboard/stats-cards";
import Image from "next/image";
import { Building2, Users, BarChart3, AlertTriangle } from "lucide-react";

export default async function PlatformAnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [
    totalOrgs,
    totalUsers,
    totalStudents,
    totalLecturers,
    totalSessions,
    totalRecords,
    flaggedRecords,
    avgConfidence,
  ] = await Promise.all([
    db.organization.count(),
    db.user.count(),
    db.user.count({ where: { role: "STUDENT" } }),
    db.user.count({ where: { role: "LECTURER" } }),
    db.attendanceSession.count(),
    db.attendanceRecord.count(),
    db.attendanceRecord.count({ where: { flagged: true } }),
    db.attendanceRecord.aggregate({ _avg: { confidence: true } }),
  ]);

  const orgStats = await db.organization.findMany({
    include: {
      _count: { select: { users: true, courses: true } },
      subscription: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Platform Analytics</h1>
        <p className="text-muted-foreground">
          System-wide metrics across all organizations
        </p>
      </div>

      <StatsGrid>
        <StatCard
          title="Organizations"
          value={totalOrgs}
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          title="Total Users"
          value={totalUsers}
          subtitle={`${totalStudents} students, ${totalLecturers} lecturers`}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Total Sessions"
          value={totalSessions}
          subtitle={`${totalRecords} attendance records`}
          icon={<BarChart3 className="h-5 w-5" />}
        />
        <StatCard
          title="Avg Confidence"
          value={`${Math.round(avgConfidence._avg.confidence || 0)}%`}
          subtitle={`${flaggedRecords} flagged records`}
          icon={<Image src="/web-app-manifest-192x192.png" alt="" width={20} height={20} className="rounded" />}
        />
      </StatsGrid>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Per Organization</h2>
        <div className="space-y-3">
          {orgStats.map((org) => (
            <div
              key={org.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-center">
                <div className="sm:col-span-2 lg:col-span-1">
                  <p className="font-medium">{org.name}</p>
                  <p className="text-xs text-muted-foreground">{org.slug}</p>
                </div>
                <div className="sm:text-center">
                  <p className="text-lg font-bold">{org._count.users}</p>
                  <p className="text-xs text-muted-foreground">Users</p>
                </div>
                <div className="sm:text-center">
                  <p className="text-lg font-bold">{org._count.courses}</p>
                  <p className="text-xs text-muted-foreground">Courses</p>
                </div>
                <div className="sm:text-center">
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {org.subscription?.plan || "FREE"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-1 lg:text-right">
                  {org.createdAt.toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
