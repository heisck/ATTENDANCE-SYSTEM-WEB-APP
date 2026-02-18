import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { StatsGrid, StatCard } from "@/components/dashboard/stats-cards";
import { Building2, Users, BarChart3, Shield, AlertTriangle } from "lucide-react";

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
          icon={<Shield className="h-5 w-5" />}
        />
      </StatsGrid>

      <div>
        <h2 className="mb-4 text-lg font-semibold">Per Organization</h2>
        <div className="space-y-3">
          {orgStats.map((org) => (
            <div
              key={org.id}
              className="grid grid-cols-5 items-center gap-4 rounded-lg border border-border bg-card p-4"
            >
              <div>
                <p className="font-medium">{org.name}</p>
                <p className="text-xs text-muted-foreground">{org.slug}</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{org._count.users}</p>
                <p className="text-xs text-muted-foreground">Users</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{org._count.courses}</p>
                <p className="text-xs text-muted-foreground">Courses</p>
              </div>
              <div className="text-center">
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {org.subscription?.plan || "FREE"}
                </span>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                {org.createdAt.toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
