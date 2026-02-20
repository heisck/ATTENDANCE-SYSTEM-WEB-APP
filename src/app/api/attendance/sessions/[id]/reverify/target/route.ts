import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncAttendanceSessionState } from "@/lib/attendance";
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
      { error: "Only lecturers can target reverification" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (syncedSession.status !== "ACTIVE" || syncedSession.phase !== "REVERIFY") {
    return NextResponse.json(
      { error: "Session is not in reverification phase" },
      { status: 409 }
    );
  }

  if (!syncedSession.reverifyEndsAt) {
    return NextResponse.json(
      { error: "Session reverification window is unavailable" },
      { status: 500 }
    );
  }

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    select: { lecturerId: true },
  });
  if (!attendanceSession || attendanceSession.lecturerId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const studentIds = Array.isArray(body?.studentIds)
    ? body.studentIds.filter((value: unknown): value is string => typeof value === "string")
    : [];

  if (studentIds.length === 0) {
    return NextResponse.json(
      { error: "studentIds is required" },
      { status: 400 }
    );
  }

  const now = new Date();
  const targetDeadline = new Date(
    Math.min(
      syncedSession.reverifyEndsAt.getTime() - 1000,
      now.getTime() + 60_000
    )
  );

  const records = await db.attendanceRecord.findMany({
    where: {
      sessionId: id,
      studentId: { in: studentIds },
    },
    select: { id: true },
  });

  if (records.length === 0) {
    return NextResponse.json(
      { error: "No matching attendance records found for selected students" },
      { status: 404 }
    );
  }

  await db.$transaction(async (tx) => {
    for (const record of records) {
      await tx.attendanceRecord.update({
        where: { id: record.id },
        data: {
          reverifyRequired: true,
          reverifyStatus: "RETRY_PENDING",
          reverifyAttemptCount: { increment: 1 },
          reverifyRequestedAt: now,
          reverifyDeadlineAt: targetDeadline,
          flagged: true,
        },
      });
    }
  });

  return NextResponse.json({
    success: true,
    message: `Reverification opened for ${records.length} student(s)`,
    deadlineAt: targetDeadline,
  });
}
