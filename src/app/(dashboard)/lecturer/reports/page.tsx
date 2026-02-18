import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

export default async function LecturerReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const courses = await db.course.findMany({
    where: { lecturerId: session.user.id },
    include: {
      _count: { select: { sessions: true, enrollments: true } },
      sessions: {
        include: { _count: { select: { records: true } } },
        orderBy: { startedAt: "desc" },
        take: 5,
      },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Attendance reports for your courses
        </p>
      </div>

      {courses.map((course) => (
        <div key={course.id} className="space-y-3">
          <h2 className="text-lg font-semibold">
            {course.code} - {course.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {course._count.enrollments} enrolled &middot;{" "}
            {course._count.sessions} sessions
          </p>
          <AttendanceTable
            columns={[
              { key: "date", label: "Session Date" },
              { key: "attendance", label: "Students Marked" },
              { key: "status", label: "Status" },
            ]}
            data={course.sessions.map((s) => ({
              date: s.startedAt.toLocaleDateString(),
              attendance: `${s._count.records} / ${course._count.enrollments}`,
              status: s.status,
            }))}
            emptyMessage="No sessions recorded yet."
          />
        </div>
      ))}

      {courses.length === 0 && (
        <p className="text-muted-foreground">No courses assigned yet.</p>
      )}
    </div>
  );
}
