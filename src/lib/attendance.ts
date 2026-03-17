import { AttendancePhase, SessionStatus } from "@prisma/client";
import { db } from "./db";
import { CACHE_KEYS, cacheGet, cacheSet } from "./cache";
import { clearSessionBleBroadcast } from "./lecturer-ble";

export const PHASE_DURATION_MS = 240_000;
export const TOTAL_SESSION_MS = PHASE_DURATION_MS;
export const QR_ROTATION_MS = 5_000;
export const QR_GRACE_MS = 1_000;
const SESSION_STATE_CACHE_MAX_TTL_SECONDS = 15;

type SessionStateRow = {
  id: string;
  status: SessionStatus;
  phase: AttendancePhase;
  startedAt: Date;
  endsAt: Date;
  closedAt: Date | null;
  relayEnabled: boolean;
  qrRotationMs: number;
  qrGraceMs: number;
};

type SessionStateCacheRow = {
  id: string;
  status: SessionStatus;
  phase: AttendancePhase;
  startedAt: string;
  endsAt: string;
  closedAt: string | null;
  relayEnabled: boolean;
  qrRotationMs: number;
  qrGraceMs: number;
};

export function getDefaultSessionEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + PHASE_DURATION_MS);
}

function serializeSessionStateRow(session: SessionStateRow): SessionStateCacheRow {
  return {
    id: session.id,
    status: session.status,
    phase: session.phase,
    startedAt: session.startedAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    closedAt: session.closedAt ? session.closedAt.toISOString() : null,
    relayEnabled: session.relayEnabled,
    qrRotationMs: session.qrRotationMs,
    qrGraceMs: session.qrGraceMs,
  };
}

function deserializeSessionStateRow(session: SessionStateCacheRow): SessionStateRow {
  return {
    id: session.id,
    status: session.status,
    phase: session.phase,
    startedAt: new Date(session.startedAt),
    endsAt: new Date(session.endsAt),
    closedAt: session.closedAt ? new Date(session.closedAt) : null,
    relayEnabled: Boolean((session as Partial<SessionStateCacheRow>).relayEnabled),
    qrRotationMs: session.qrRotationMs,
    qrGraceMs: session.qrGraceMs,
  };
}

export function deriveAttendancePhase(
  session: Pick<SessionStateRow, "status" | "phase" | "endsAt">,
  now: Date = new Date()
): AttendancePhase {
  if (session.status === "CLOSED") {
    return "CLOSED";
  }
  if (now >= session.endsAt) {
    return "CLOSED";
  }
  return session.phase;
}

export function getBoundedSessionTtlSeconds(
  endsAt: Date,
  maxSeconds: number,
  minSeconds: number = 1,
  now: Date = new Date()
) {
  const remainingSeconds = Math.ceil((endsAt.getTime() - now.getTime()) / 1000);
  if (remainingSeconds <= minSeconds) {
    return minSeconds;
  }
  return Math.max(minSeconds, Math.min(maxSeconds, remainingSeconds));
}

export async function syncAttendanceSessionState(
  sessionId: string
): Promise<SessionStateRow | null> {
  const now = new Date();
  const cacheKey = CACHE_KEYS.SESSION_STATE(sessionId);
  const cached = await cacheGet<SessionStateCacheRow>(cacheKey);
  if (cached) {
    return deserializeSessionStateRow(cached);
  }

  let session = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      phase: true,
      startedAt: true,
      endsAt: true,
      closedAt: true,
      relayEnabled: true,
      qrRotationMs: true,
      qrGraceMs: true,
    },
  });

  if (!session) return null;

  const derivedPhase = deriveAttendancePhase(
    {
      status: session.status,
      phase: session.phase,
      endsAt: session.endsAt,
    },
    now
  );

  const updateData: Record<string, unknown> = {};
  if (derivedPhase === "CLOSED") {
    updateData.phase = "CLOSED";
    if (session.status !== "CLOSED") updateData.status = "CLOSED";
    if (!session.closedAt) updateData.closedAt = now;
    updateData.relayEnabled = false;
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
        endsAt: true,
        closedAt: true,
        relayEnabled: true,
        qrRotationMs: true,
        qrGraceMs: true,
      },
    });
  }

  if (session.status === "CLOSED" || session.phase === "CLOSED") {
    await clearSessionBleBroadcast(session.id);
  }

  await cacheSet(
    cacheKey,
    serializeSessionStateRow(session),
    getBoundedSessionTtlSeconds(session.endsAt, SESSION_STATE_CACHE_MAX_TTL_SECONDS, 1, now)
  );
  return session;
}

export function getPhaseEndsAt(session: Pick<SessionStateRow, "endsAt">): Date {
  return session.endsAt;
}
