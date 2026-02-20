import { AttendancePhase, ReverifyStatus, SessionStatus } from "@prisma/client";
import { db } from "./db";

export const INITIAL_PHASE_MS = 60_000;
export const REVERIFY_PHASE_MS = 240_000;
export const TOTAL_SESSION_MS = INITIAL_PHASE_MS + REVERIFY_PHASE_MS;
export const QR_ROTATION_MS = 5_000;
export const QR_GRACE_MS = 1_000;
export const REVERIFY_MAX_ATTEMPTS = 3;
export const REVERIFY_MAX_RETRIES = 2;
export const REVERIFY_SAFETY_BUFFER_MS = 15_000;
export const REVERIFY_MIN_SLOT_MS = 12_000;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shuffleIds(ids: string[]): string[] {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
      select: { id: true },
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

    const selectedIds = shuffleIds(candidates.map((c) => c.id)).slice(
      0,
      selectedCount
    );

    const reverifyEndTs = session.reverifyEndsAt.getTime();
    const usableWindowMs = Math.max(
      30_000,
      reverifyEndTs - now.getTime() - REVERIFY_SAFETY_BUFFER_MS
    );
    const spacingMs = Math.max(
      REVERIFY_MIN_SLOT_MS,
      Math.floor(usableWindowMs / selectedIds.length)
    );

    for (let index = 0; index < selectedIds.length; index++) {
      const slotDeadlineTs = Math.min(
        reverifyEndTs - QR_GRACE_MS,
        now.getTime() + Math.max(20_000, spacingMs * (index + 1))
      );

      await tx.attendanceRecord.update({
        where: { id: selectedIds[index] },
        data: {
          reverifyRequired: true,
          reverifyStatus: "PENDING",
          reverifyAttemptCount: 1,
          reverifyRequestedAt: now,
          reverifyDeadlineAt: new Date(slotDeadlineTs),
          flagged: false,
        },
      });
    }

    await tx.attendanceSession.update({
      where: { id: sessionId },
      data: {
        reverifySelectionDone: true,
        reverifySelectedCount: selectedIds.length,
      },
    });
  });
}

async function expirePendingReverify(sessionId: string, now: Date): Promise<void> {
  const staleRows = await db.attendanceRecord.findMany({
    where: {
      sessionId,
      reverifyStatus: {
        in: ["PENDING", "RETRY_PENDING"],
      },
      reverifyDeadlineAt: { lt: now },
    },
    select: {
      id: true,
      reverifyAttemptCount: true,
    },
  });

  if (staleRows.length === 0) return;

  await db.$transaction(async (tx) => {
    for (const row of staleRows) {
      const exhausted = row.reverifyAttemptCount >= REVERIFY_MAX_ATTEMPTS;
      await tx.attendanceRecord.update({
        where: { id: row.id },
        data: {
          reverifyStatus: exhausted ? "FAILED" : "MISSED",
          reverifyDeadlineAt: null,
          flagged: true,
        },
      });
    }
  });
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
    await expirePendingReverify(sessionId, now);

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

export async function allocateRetryDeadline(
  sessionId: string,
  reverifyEndsAt: Date,
  now: Date
): Promise<Date | null> {
  const pendingCount = await db.attendanceRecord.count({
    where: {
      sessionId,
      reverifyStatus: "RETRY_PENDING",
      reverifyDeadlineAt: { gt: now },
    },
  });

  const remainingMs =
    reverifyEndsAt.getTime() - now.getTime() - REVERIFY_SAFETY_BUFFER_MS;
  if (remainingMs <= REVERIFY_MIN_SLOT_MS) {
    return null;
  }

  const slotMs = Math.max(
    REVERIFY_MIN_SLOT_MS,
    Math.floor(remainingMs / Math.max(2, pendingCount + 2))
  );

  return new Date(
    Math.min(reverifyEndsAt.getTime() - QR_GRACE_MS, now.getTime() + slotMs)
  );
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
