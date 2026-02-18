import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAttendanceReport } from "@/services/attendance.service";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId");
  const format = searchParams.get("format") || "csv";

  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  const report = await getAttendanceReport(courseId);
  if (!report) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  if (format === "csv") {
    const header = "Student ID,Name,Sessions Attended,Total Sessions,Percentage\n";
    const rows = report.report
      .map(
        (r) =>
          `${r.studentId || ""},${r.name},${r.sessionsAttended},${r.totalSessions},${r.percentage}%`
      )
      .join("\n");
    const csv = header + rows;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${report.course.code}_attendance.csv"`,
      },
    });
  }

  return NextResponse.json(report);
}
