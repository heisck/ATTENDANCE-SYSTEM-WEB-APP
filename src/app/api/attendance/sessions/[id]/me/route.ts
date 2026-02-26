import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  REVERIFY_SLOT_NOTIFY_LEAD_MS,
  REVERIFY_MAX_ATTEMPTS,
  REVERIFY_MAX_RETRIES,
  getReverifyPromptAt,
  getReverifySlotFromRecord,
  getPhaseEndsAt,
  syncAttendanceSessionState,
} from "@/lib/attendance";
import { getQrPortStatus } from "@/lib/qr-port";
import { db } from "@/lib/db";
import { getQrSequence } from "@/lib/qr";

export async function GET(
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
      { error: "Only students can access this endpoint" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    include: {
      course: {
        include: {
          enrollments: {
            where: { studentId: user.id },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!attendanceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (attendanceSession.course.enrollments.length === 0) {
    return NextResponse.json(
      { error: "You are not enrolled in this course" },
      { status: 403 }
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
      markedAt: true,
      reverifyRequired: true,
      reverifyStatus: true,
      reverifyRequestedAt: true,
      reverifyDeadlineAt: true,
      reverifyAttemptCount: true,
      reverifyRetryCount: true,
      reverifyMarkedAt: true,
      reverifyManualOverride: true,
      flagged: true,
    },
  });

  const canRequestRetry =
    syncedSession.status === "ACTIVE" &&
    syncedSession.phase === "REVERIFY" &&
    !!record &&
    record.reverifyStatus === "MISSED" &&
    record.reverifyRetryCount < REVERIFY_MAX_RETRIES &&
    record.reverifyAttemptCount < REVERIFY_MAX_ATTEMPTS;

  const currentSequence = getQrSequence(Date.now(), syncedSession.qrRotationMs);
  const qrPortStatus = await getQrPortStatus(id, user.id);
  const slot = record
    ? getReverifySlotFromRecord(
        record.reverifyRequestedAt,
        record.reverifyDeadlineAt,
        syncedSession.qrRotationMs,
        syncedSession.qrGraceMs
      )
    : null;
  const promptAt = slot ? getReverifyPromptAt(slot.startsAt) : null;

  let reverifyBatchNumber: number | null = null;
  let reverifyTotalBatches: number | null = null;
  if (slot) {
    const slotRows = await db.attendanceRecord.findMany({
      where: {
        sessionId: id,
        reverifyRequired: true,
        reverifyStatus: {
          in: ["PENDING", "RETRY_PENDING"],
        },
        reverifyRequestedAt: { not: null },
      },
      select: {
        reverifyRequestedAt: true,
      },
      orderBy: { reverifyRequestedAt: "asc" },
    });

    const uniqueSlots = Array.from(
      new Set(
        slotRows
          .map((row) => row.reverifyRequestedAt?.getTime() ?? 0)
          .filter((value) => value > 0)
      )
    );
    reverifyTotalBatches = uniqueSlots.length > 0 ? uniqueSlots.length : null;
    if (reverifyTotalBatches) {
      const idx = uniqueSlots.findIndex((value) => value === slot.startsAt.getTime());
      reverifyBatchNumber = idx >= 0 ? idx + 1 : null;
    }
  }

  return NextResponse.json({
    serverNow: new Date().toISOString(),
    session: {
      id: syncedSession.id,
      status: syncedSession.status,
      phase: syncedSession.phase,
      phaseEndsAt: getPhaseEndsAt(syncedSession),
      currentSequenceId: `E${String(currentSequence).padStart(3, "0")}`,
      nextSequenceId: `E${String(currentSequence + 1).padStart(3, "0")}`,
    },
    attendance: record
      ? {
          id: record.id,
          initialMarkedAt: record.markedAt,
          reverifyRequired: record.reverifyRequired,
          reverifyStatus: record.reverifyStatus,
          reverifyRequestedAt: record.reverifyRequestedAt,
          reverifyDeadlineAt: record.reverifyDeadlineAt,
          reverifySlotStartsAt: slot?.startsAt ?? null,
          reverifySlotEndsAt: slot?.endsAt ?? null,
          reverifyTargetSequence: slot?.sequence ?? null,
          reverifyTargetSequenceId: slot?.sequenceId ?? null,
          reverifyPromptAt: promptAt,
          reverifyNotifyLeadMs: REVERIFY_SLOT_NOTIFY_LEAD_MS,
          reverifyBatchNumber,
          reverifyTotalBatches,
          reverifyAttemptCount: record.reverifyAttemptCount,
          reverifyRetryCount: record.reverifyRetryCount,
          reverifyMarkedAt: record.reverifyMarkedAt,
          reverifyManualOverride: record.reverifyManualOverride,
          flagged: record.flagged,
          canRequestRetry,
        }
      : null,
    qrPortStatus,
  });
}
