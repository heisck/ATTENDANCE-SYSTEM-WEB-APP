import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { allocateRetrySlot, syncAttendanceSessionState } from "@/lib/attendance";
import { db } from "@/lib/db";
import { notifyStudentReverifySlot } from "@/lib/reverify-notifications";

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

  const records = await db.attendanceRecord.findMany({
    where: {
      sessionId: id,
      studentId: { in: studentIds },
    },
    select: {
      id: true,
      studentId: true,
      reverifyAttemptCount: true,
      reverifyRetryCount: true,
    },
  });

  if (records.length === 0) {
    return NextResponse.json(
      { error: "No matching attendance records found for selected students" },
      { status: 404 }
    );
  }

  const assignments: Array<{
    studentId: string;
    sequence: number;
    slotStartsAt: Date;
    slotEndsAt: Date;
    attemptCount: number;
    retryCount: number;
  }> = [];

  for (const record of records) {
    const slot = await allocateRetrySlot(id, syncedSession, now);
    if (!slot) continue;

    const updated = await db.attendanceRecord.update({
      where: { id: record.id },
      data: {
        reverifyRequired: true,
        reverifyStatus: "RETRY_PENDING",
        reverifyAttemptCount: { increment: 1 },
        reverifyRequestedAt: slot.startsAt,
        reverifyDeadlineAt: slot.endsAt,
        flagged: true,
      },
      select: {
        studentId: true,
        reverifyAttemptCount: true,
        reverifyRetryCount: true,
      },
    }
    );

    assignments.push({
      studentId: updated.studentId,
      sequence: slot.sequence,
      slotStartsAt: slot.startsAt,
      slotEndsAt: slot.endsAt,
      attemptCount: updated.reverifyAttemptCount,
      retryCount: updated.reverifyRetryCount,
    });
  }

  if (assignments.length > 0) {
    await Promise.allSettled(
      assignments.map((item) =>
        notifyStudentReverifySlot({
          studentId: item.studentId,
          sessionId: id,
          sequence: item.sequence,
          slotStartsAt: item.slotStartsAt,
          slotEndsAt: item.slotEndsAt,
          attemptCount: item.attemptCount,
          retryCount: item.retryCount,
          reason: "LECTURER_TARGET",
        })
      )
    );
  }

  if (assignments.length === 0) {
    return NextResponse.json(
      { error: "No reverification slots are available in the remaining session window" },
      { status: 409 }
    );
  }

  return NextResponse.json({
    success: true,
    message: `Reverification opened for ${assignments.length} student(s)`,
    assignedCount: assignments.length,
  });
}
