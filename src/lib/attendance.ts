import { AttendancePhase, ReverifyStatus, SessionStatus } from "@prisma/client";
import { db } from "./db";
import {
  formatQrSequenceId,
  getQrSequence,
  getQrSequenceStartTs,
} from "./qr";
import { notifyStudentReverifySlot } from "./reverify-notifications";

export const INITIAL_PHASE_MS = 60_000;
export const REVERIFY_PHASE_MS = 240_000;
export const TOTAL_SESSION_MS = INITIAL_PHASE_MS + REVERIFY_PHASE_MS;
export const QR_ROTATION_MS = 5_000;
export const QR_GRACE_MS = 1_000;
export const REVERIFY_MAX_ATTEMPTS = 3;
export const REVERIFY_MAX_RETRIES = 2;
export const REVERIFY_SAFETY_BUFFER_MS = 15_000;
export const REVERIFY_SLOT_NOTIFY_LEAD_MS = 10_000;
export const EXPECTED_RETRY_RATE = 0.35;
export const EXPECTED_ATTEMPT_P95_MS = 9_000;

type SessionStateRow = {
  id: string;
  status: SessionStatus;
  phase: AttendancePhase;
  startedAt: Date;
  closedAt: Date | null;
  initialEndsAt: Date | null;
  reverifyEndsAt: Date | null;
  qrRotationMs: number;
  qrGraceMs: number;
  reverifySelectionRate: number;
  reverifySelectionDone: boolean;
  reverifySelectedCount: number;
};

type ReverifySequenceBounds = {
  startSequence: number;
  endSequence: number;
  slotCount: number;
};

export type ReverifySlot = {
  sequence: number;
  sequenceId: string;
  startsAt: Date;
  endsAt: Date;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shuffleItems<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getReverifySequenceBounds(
  now: Date,
  reverifyEndsAt: Date,
  rotationMs: number,
  graceMs: number
): ReverifySequenceBounds | null {
  const windowEndTs = reverifyEndsAt.getTime() - REVERIFY_SAFETY_BUFFER_MS;
  const earliestStartTs = now.getTime() + REVERIFY_SLOT_NOTIFY_LEAD_MS;
  const latestStartTs = windowEndTs - (rotationMs + graceMs);

  if (latestStartTs < earliestStartTs) return null;

  const startSequence = Math.ceil(earliestStartTs / rotationMs);
  const endSequence = Math.floor(latestStartTs / rotationMs);
  if (endSequence < startSequence) return null;

  return {
    startSequence,
    endSequence,
    slotCount: endSequence - startSequence + 1,
  };
}

function buildSlotFromSequence(
  sequence: number,
  rotationMs: number,
  graceMs: number
): ReverifySlot {
  const slotStartTs = getQrSequenceStartTs(sequence, rotationMs);
  return {
    sequence,
    sequenceId: formatQrSequenceId(sequence),
    startsAt: new Date(slotStartTs),
    endsAt: new Date(slotStartTs + rotationMs + graceMs),
  };
}

export function getReverifyPromptAt(slotStartsAt: Date): Date {
  return new Date(slotStartsAt.getTime() - REVERIFY_SLOT_NOTIFY_LEAD_MS);
}

export function getReverifySlotFromRecord(
  requestedAt: Date | null,
  deadlineAt: Date | null,
  rotationMs: number,
  graceMs: number
): ReverifySlot | null {
  if (!requestedAt) return null;

  const sequence = getQrSequence(requestedAt.getTime(), rotationMs);
  return {
    sequence,
    sequenceId: formatQrSequenceId(sequence),
    startsAt: requestedAt,
    endsAt: deadlineAt ?? new Date(requestedAt.getTime() + rotationMs + graceMs),
  };
}

export function getDefaultInitialEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + INITIAL_PHASE_MS);
}

export function getDefaultReverifyEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + TOTAL_SESSION_MS);
}

export function deriveAttendancePhase(
  session: Pick<SessionStateRow, "status" | "startedAt" | "initialEndsAt" | "reverifyEndsAt">,
  now: Date = new Date()
): AttendancePhase {
  if (session.status === "CLOSED") {
    return "CLOSED";
  }

  const initialEndsAt = session.initialEndsAt ?? getDefaultInitialEndsAt(session.startedAt);
  const reverifyEndsAt = session.reverifyEndsAt ?? getDefaultReverifyEndsAt(session.startedAt);

  if (now >= reverifyEndsAt) return "CLOSED";
  if (now >= initialEndsAt) return "REVERIFY";
  return "INITIAL";
}

export function computeAdaptiveSelectionCount(
  eligibleCount: number,
  selectionRate: number
): number {
  if (eligibleCount <= 0) return 0;

  const normalizedRate = clamp(selectionRate, 0.05, 1);
  const baseTarget = Math.max(1, Math.ceil(eligibleCount * normalizedRate));

  const usableWindowMs = REVERIFY_PHASE_MS - REVERIFY_SAFETY_BUFFER_MS;
  const totalAttemptCapacity = Math.max(
    1,
    Math.floor((usableWindowMs / EXPECTED_ATTEMPT_P95_MS) * 0.85)
  );

  const expectedAttemptsPerSelected =
    1 + EXPECTED_RETRY_RATE + EXPECTED_RETRY_RATE * EXPECTED_RETRY_RATE;
  const maxByCapacity = Math.max(
    1,
    Math.floor(totalAttemptCapacity / expectedAttemptsPerSelected)
  );

  return Math.min(eligibleCount, Math.min(baseTarget, maxByCapacity));
}

async function ensureReverifySelection(
  sessionId: string,
  now: Date
): Promise<void> {
  let scheduledNotifications: Array<{
    studentId: string;
    sequence: number;
    slotStartsAt: Date;
    slotEndsAt: Date;
    batchNumber: number;
    totalBatches: number;
  }> = [];

  await db.$transaction(async (tx) => {
    const session = await tx.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        phase: true,
        reverifySelectionDone: true,
        reverifySelectionRate: true,
        reverifyEndsAt: true,
        qrRotationMs: true,
        qrGraceMs: true,
      },
    });

    if (!session) return;
    if (session.status !== "ACTIVE" || session.phase !== "REVERIFY") return;
    if (session.reverifySelectionDone) return;
    if (!session.reverifyEndsAt) return;

    const candidates = await tx.attendanceRecord.findMany({
      where: {
        sessionId,
        reverifyStatus: "NOT_REQUIRED",
      },
      select: { id: true, studentId: true },
    });

    const selectedCount = computeAdaptiveSelectionCount(
      candidates.length,
      session.reverifySelectionRate
    );

    if (selectedCount <= 0) {
      await tx.attendanceSession.update({
        where: { id: sessionId },
        data: {
          reverifySelectionDone: true,
          reverifySelectedCount: 0,
        },
      });
      return;
    }

    const sequenceBounds = getReverifySequenceBounds(
      now,
      session.reverifyEndsAt,
      session.qrRotationMs,
      session.qrGraceMs
    );
    if (!sequenceBounds) {
      await tx.attendanceSession.update({
        where: { id: sessionId },
        data: {
          reverifySelectionDone: true,
          reverifySelectedCount: 0,
        },
      });
      return;
    }

    const selectedCandidates = shuffleItems(candidates).slice(0, selectedCount);
    const studentsPerSlot = Math.max(
      1,
      Math.ceil(selectedCandidates.length / sequenceBounds.slotCount)
    );
    const totalBatches = Math.ceil(selectedCandidates.length / studentsPerSlot);

    for (let index = 0; index < selectedCandidates.length; index++) {
      const slotOffset = Math.floor(index / studentsPerSlot);
      const sequence = sequenceBounds.startSequence + slotOffset;
      const slot = buildSlotFromSequence(
        sequence,
        session.qrRotationMs,
        session.qrGraceMs
      );

      await tx.attendanceRecord.update({
        where: { id: selectedCandidates[index].id },
        data: {
          reverifyRequired: true,
          reverifyStatus: "PENDING",
          reverifyAttemptCount: 1,
          reverifyRetryCount: 0,
          reverifyRequestedAt: slot.startsAt,
          reverifyDeadlineAt: slot.endsAt,
          flagged: false,
        },
      });

      scheduledNotifications.push({
        studentId: selectedCandidates[index].studentId,
        sequence: slot.sequence,
        slotStartsAt: slot.startsAt,
        slotEndsAt: slot.endsAt,
        batchNumber: slotOffset + 1,
        totalBatches,
      });
    }

    await tx.attendanceSession.update({
      where: { id: sessionId },
      data: {
        reverifySelectionDone: true,
        reverifySelectedCount: selectedCandidates.length,
      },
    });
  });

  if (scheduledNotifications.length > 0) {
    await Promise.allSettled(
      scheduledNotifications.map((item) =>
        notifyStudentReverifySlot({
          studentId: item.studentId,
          sessionId,
          sequence: item.sequence,
          slotStartsAt: item.slotStartsAt,
          slotEndsAt: item.slotEndsAt,
          attemptCount: 1,
          retryCount: 0,
          batchNumber: item.batchNumber,
          totalBatches: item.totalBatches,
          reason: "INITIAL_SELECTION",
        })
      )
    );
  }
}

async function expirePendingReverify(
  session: SessionStateRow,
  now: Date
): Promise<void> {
  const staleRows = await db.attendanceRecord.findMany({
    where: {
      sessionId: session.id,
      reverifyStatus: {
        in: ["PENDING", "RETRY_PENDING"],
      },
      reverifyDeadlineAt: { lt: now },
    },
    select: {
      id: true,
      studentId: true,
      reverifyAttemptCount: true,
      reverifyRetryCount: true,
    },
    orderBy: { reverifyDeadlineAt: "asc" },
  });

  if (staleRows.length === 0) return;

  const pendingStatuses: ReverifyStatus[] = ["PENDING", "RETRY_PENDING"];
  const notificationsToSend: Array<{
    studentId: string;
    sequence: number;
    slotStartsAt: Date;
    slotEndsAt: Date;
    attemptCount: number;
    retryCount: number;
  }> = [];

  for (const row of staleRows) {
    const canRetry =
      row.reverifyAttemptCount < REVERIFY_MAX_ATTEMPTS &&
      row.reverifyRetryCount < REVERIFY_MAX_RETRIES;

    if (canRetry) {
      const slot = await allocateRetrySlot(session.id, session, now);
      if (slot) {
        const promoted = await db.attendanceRecord.updateMany({
          where: {
            id: row.id,
            reverifyStatus: { in: pendingStatuses },
            reverifyDeadlineAt: { lt: now },
          },
          data: {
            reverifyStatus: "RETRY_PENDING",
            reverifyRetryCount: { increment: 1 },
            reverifyAttemptCount: { increment: 1 },
            reverifyRequestedAt: slot.startsAt,
            reverifyDeadlineAt: slot.endsAt,
            flagged: true,
          },
        });

        if (promoted.count === 1) {
          notificationsToSend.push({
            studentId: row.studentId,
            sequence: slot.sequence,
            slotStartsAt: slot.startsAt,
            slotEndsAt: slot.endsAt,
            attemptCount: row.reverifyAttemptCount + 1,
            retryCount: row.reverifyRetryCount + 1,
          });
          continue;
        }
      }
    }

    const exhausted =
      row.reverifyAttemptCount >= REVERIFY_MAX_ATTEMPTS ||
      row.reverifyRetryCount >= REVERIFY_MAX_RETRIES;

    await db.attendanceRecord.updateMany({
      where: {
        id: row.id,
        reverifyStatus: { in: pendingStatuses },
        reverifyDeadlineAt: { lt: now },
      },
      data: {
        reverifyStatus: exhausted ? "FAILED" : "MISSED",
        reverifyDeadlineAt: null,
        flagged: true,
      },
    });
  }

  if (notificationsToSend.length > 0) {
    await Promise.allSettled(
      notificationsToSend.map((item) =>
        notifyStudentReverifySlot({
          studentId: item.studentId,
          sessionId: session.id,
          sequence: item.sequence,
          slotStartsAt: item.slotStartsAt,
          slotEndsAt: item.slotEndsAt,
          attemptCount: item.attemptCount,
          retryCount: item.retryCount,
          reason: "AUTO_RETRY",
        })
      )
    );
  }
}

export async function syncAttendanceSessionState(
  sessionId: string
): Promise<SessionStateRow | null> {
  const now = new Date();

  let session = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      phase: true,
      startedAt: true,
      closedAt: true,
      initialEndsAt: true,
      reverifyEndsAt: true,
      qrRotationMs: true,
      qrGraceMs: true,
      reverifySelectionRate: true,
      reverifySelectionDone: true,
      reverifySelectedCount: true,
    },
  });

  if (!session) return null;

  const initialEndsAt = session.initialEndsAt ?? getDefaultInitialEndsAt(session.startedAt);
  const reverifyEndsAt = session.reverifyEndsAt ?? getDefaultReverifyEndsAt(session.startedAt);
  const derivedPhase = deriveAttendancePhase(
    {
      status: session.status,
      startedAt: session.startedAt,
      initialEndsAt,
      reverifyEndsAt,
    },
    now
  );

  const updateData: Record<string, unknown> = {};
  if (!session.initialEndsAt) updateData.initialEndsAt = initialEndsAt;
  if (!session.reverifyEndsAt) updateData.reverifyEndsAt = reverifyEndsAt;

  if (derivedPhase === "CLOSED") {
    updateData.phase = "CLOSED";
    if (session.status !== "CLOSED") updateData.status = "CLOSED";
    if (!session.closedAt) updateData.closedAt = now;
  } else if (session.phase !== derivedPhase) {
    updateData.phase = derivedPhase;
  }

  if (Object.keys(updateData).length > 0) {
    session = await db.attendanceSession.update({
      where: { id: sessionId },
      data: updateData,
      select: {
        id: true,
        status: true,
        phase: true,
        startedAt: true,
        closedAt: true,
        initialEndsAt: true,
        reverifyEndsAt: true,
        qrRotationMs: true,
        qrGraceMs: true,
        reverifySelectionRate: true,
        reverifySelectionDone: true,
        reverifySelectedCount: true,
      },
    });
  }

  if (session.phase === "REVERIFY" && session.status === "ACTIVE") {
    await ensureReverifySelection(sessionId, now);
    await expirePendingReverify(session, now);

    session = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        phase: true,
        startedAt: true,
        closedAt: true,
        initialEndsAt: true,
        reverifyEndsAt: true,
        qrRotationMs: true,
        qrGraceMs: true,
        reverifySelectionRate: true,
        reverifySelectionDone: true,
        reverifySelectedCount: true,
      },
    });
  }

  return session;
}

export async function allocateRetrySlot(
  sessionId: string,
  session: Pick<SessionStateRow, "reverifyEndsAt" | "qrRotationMs" | "qrGraceMs">,
  now: Date
): Promise<ReverifySlot | null> {
  if (!session.reverifyEndsAt) return null;

  const bounds = getReverifySequenceBounds(
    now,
    session.reverifyEndsAt,
    session.qrRotationMs,
    session.qrGraceMs
  );
  if (!bounds) return null;

  const latestReserved = await db.attendanceRecord.findFirst({
    where: {
      sessionId,
      reverifyStatus: {
        in: ["PENDING", "RETRY_PENDING"],
      },
      reverifyRequestedAt: { not: null },
      reverifyDeadlineAt: { gt: now },
    },
    select: {
      reverifyRequestedAt: true,
    },
    orderBy: { reverifyRequestedAt: "desc" },
  });

  let sequence = bounds.startSequence;
  if (latestReserved?.reverifyRequestedAt) {
    const latestSequence = getQrSequence(
      latestReserved.reverifyRequestedAt.getTime(),
      session.qrRotationMs
    );
    sequence = Math.max(sequence, latestSequence + 1);
  }

  if (sequence > bounds.endSequence) {
    return null;
  }

  return buildSlotFromSequence(sequence, session.qrRotationMs, session.qrGraceMs);
}

export function getPhaseEndsAt(
  session: Pick<SessionStateRow, "phase" | "initialEndsAt" | "reverifyEndsAt" | "startedAt">
): Date {
  if (session.phase === "INITIAL") {
    return session.initialEndsAt ?? getDefaultInitialEndsAt(session.startedAt);
  }
  return session.reverifyEndsAt ?? getDefaultReverifyEndsAt(session.startedAt);
}

export function isReverifyPending(status: ReverifyStatus): boolean {
  return status === "PENDING" || status === "RETRY_PENDING";
}
