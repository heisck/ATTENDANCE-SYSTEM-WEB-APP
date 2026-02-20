import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  REVERIFY_MAX_ATTEMPTS,
  REVERIFY_MAX_RETRIES,
  allocateRetryDeadline,
  syncAttendanceSessionState,
} from "@/lib/attendance";
import { db } from "@/lib/db";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can request reverification" },
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
      { error: "Reverification window is closed" },
      { status: 410 }
    );
  }

  if (!syncedSession.reverifyEndsAt) {
    return NextResponse.json(
      { error: "Session reverification window is unavailable" },
      { status: 500 }
    );
  }

  const record = await db.attendanceRecord.findUnique({
    where: {
      sessionId_studentId: {
        sessionId: id,
        studentId: user.id,
      },
    },
    select: {
      id: true,
      reverifyRequired: true,
      reverifyStatus: true,
      reverifyAttemptCount: true,
      reverifyRetryCount: true,
    },
  });

  if (!record || !record.reverifyRequired) {
    return NextResponse.json(
      { error: "You are not selected for reverification" },
      { status: 403 }
    );
  }

  if (record.reverifyStatus !== "MISSED") {
    return NextResponse.json(
      { error: "Retry can only be requested after a missed reverification slot" },
      { status: 409 }
    );
  }

  if (
    record.reverifyRetryCount >= REVERIFY_MAX_RETRIES ||
    record.reverifyAttemptCount >= REVERIFY_MAX_ATTEMPTS
  ) {
    await db.attendanceRecord.update({
      where: { id: record.id },
      data: {
        reverifyStatus: "FAILED",
        flagged: true,
      },
    });

    return NextResponse.json(
      { error: "Maximum reverification retries reached" },
      { status: 409 }
    );
  }

  const now = new Date();
  const retryDeadline = await allocateRetryDeadline(
    id,
    syncedSession.reverifyEndsAt,
    now
  );
  if (!retryDeadline) {
    await db.attendanceRecord.update({
      where: { id: record.id },
      data: {
        reverifyStatus: "FAILED",
        flagged: true,
      },
    });

    return NextResponse.json(
      { error: "No remaining time slot is available for retry" },
      { status: 409 }
    );
  }

  const updated = await db.attendanceRecord.update({
    where: { id: record.id },
    data: {
      reverifyStatus: "RETRY_PENDING",
      reverifyRetryCount: { increment: 1 },
      reverifyAttemptCount: { increment: 1 },
      reverifyRequestedAt: now,
      reverifyDeadlineAt: retryDeadline,
      flagged: true,
    },
    select: {
      id: true,
      reverifyStatus: true,
      reverifyRetryCount: true,
      reverifyAttemptCount: true,
      reverifyDeadlineAt: true,
    },
  });

  return NextResponse.json({
    success: true,
    message: "Retry slot assigned",
    record: updated,
  });
}
