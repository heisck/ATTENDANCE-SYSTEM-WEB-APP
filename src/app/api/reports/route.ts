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

  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  const report = await getAttendanceReport(courseId);
  if (!report) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  return NextResponse.json(report);
}
