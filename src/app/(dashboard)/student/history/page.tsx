import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

export default async function StudentHistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const records = await db.attendanceRecord.findMany({
    where: { studentId: session.user.id },
    include: {
      session: { include: { course: true } },
    },
    orderBy: { markedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Attendance History</h1>
        <p className="text-muted-foreground">
          Complete record of all your attendance marks
        </p>
      </div>

      <AttendanceTable
        columns={[
          { key: "course", label: "Course" },
          { key: "date", label: "Date" },
          { key: "time", label: "Time" },
          { key: "distance", label: "GPS Distance" },
          { key: "ip", label: "IP Trusted" },
          { key: "webauthn", label: "Biometric" },
          { key: "confidence", label: "Confidence" },
          { key: "status", label: "Status" },
        ]}
        data={records.map((r) => ({
          course: `${r.session.course.code} - ${r.session.course.name}`,
          date: r.markedAt.toLocaleDateString(),
          time: r.markedAt.toLocaleTimeString(),
          distance: `${Math.round(r.gpsDistance)}m`,
          ip: r.ipTrusted ? "Yes" : "No",
          webauthn: r.webauthnUsed ? "Yes" : "No",
          confidence: `${r.confidence}%`,
          status: r.flagged ? "Flagged" : "Verified",
        }))}
        emptyMessage="No attendance history yet."
      />
    </div>
  );
}
