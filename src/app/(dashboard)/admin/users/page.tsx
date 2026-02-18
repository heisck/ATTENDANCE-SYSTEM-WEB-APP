import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId;
  if (!orgId) redirect("/login");

  const users = await db.user.findMany({
    where: { organizationId: orgId },
    include: {
      _count: { select: { credentials: true, attendances: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-muted-foreground">
          All users in your university
        </p>
      </div>

      <AttendanceTable
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "role", label: "Role" },
          { key: "studentId", label: "Student ID" },
          { key: "device", label: "Device Registered" },
          { key: "attendance", label: "Attendance Count" },
          { key: "joined", label: "Joined" },
        ]}
        data={users.map((u) => ({
          name: u.name,
          email: u.email,
          role: u.role,
          studentId: u.studentId || "-",
          device: u._count.credentials > 0 ? "Yes" : "No",
          attendance: u._count.attendances,
          joined: u.createdAt.toLocaleDateString(),
        }))}
      />
    </div>
  );
}
