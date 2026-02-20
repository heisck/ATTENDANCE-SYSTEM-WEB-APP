import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "LECTURER") {
    return NextResponse.json(
      { error: "Only lecturers can perform manual marking" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    select: { lecturerId: true },
  });
  if (!attendanceSession || attendanceSession.lecturerId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  if (!studentId) {
    return NextResponse.json(
      { error: "studentId is required" },
      { status: 400 }
    );
  }

  const record = await db.attendanceRecord.findUnique({
    where: {
      sessionId_studentId: {
        sessionId: id,
        studentId,
      },
    },
    select: { id: true },
  });

  if (!record) {
    return NextResponse.json(
      { error: "Attendance record not found for student" },
      { status: 404 }
    );
  }

  const now = new Date();
  const updated = await db.attendanceRecord.update({
    where: { id: record.id },
    data: {
      reverifyRequired: true,
      reverifyStatus: "MANUAL_PRESENT",
      reverifyMarkedAt: now,
      reverifyManualOverride: true,
      reverifyManualOverriddenAt: now,
      flagged: false,
    },
    select: {
      id: true,
      reverifyStatus: true,
      reverifyManualOverride: true,
      reverifyManualOverriddenAt: true,
    },
  });

  return NextResponse.json({ success: true, record: updated });
}
