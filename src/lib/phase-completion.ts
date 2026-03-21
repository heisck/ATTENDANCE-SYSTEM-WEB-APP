import { db } from "@/lib/db";
import { cacheDel, cacheGet, cacheSet } from "@/lib/cache";
import { getHistoricalPhaseFromSession, resolveSessionFamilyKey } from "@/lib/session-flow";

export type PendingPhase = "PHASE_ONE" | "PHASE_TWO" | null;
const PHASE_ONE_FLAG = 1;
const PHASE_TWO_FLAG = 2;
const PHASE_COMPLETION_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

const phaseCompletionSnapshotInFlight = new Map<
  string,
  Promise<Record<string, number>>
>();
const phaseCompletionSnapshotCache = new Map<
  string,
  {
    expiresAtMs: number;
    snapshot: Record<string, number>;
  }
>();

export type StudentPhaseCompletion = {
  phaseOneDone: boolean;
  phaseTwoDone: boolean;
  overallPresent: boolean;
  pendingPhase: PendingPhase;
};

function getUtcDayRange(reference: Date) {
  const start = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function buildPhaseCompletionCacheKey(input: {
  studentId: string;
  sessionFamilyId?: string | null;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}) {
  const familyKey = resolveSessionFamilyKey({
    sessionFamilyId: input.sessionFamilyId,
    courseId: input.courseId,
    lecturerId: input.lecturerId,
    startedAt: input.referenceTime,
  });

  return `attendance:phase-completion:${input.studentId}:${familyKey}`;
}

function buildPhaseCompletionSnapshotCacheKey(input: {
  sessionFamilyId?: string | null;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}) {
  const familyKey = resolveSessionFamilyKey({
    sessionFamilyId: input.sessionFamilyId,
    courseId: input.courseId,
    lecturerId: input.lecturerId,
    startedAt: input.referenceTime,
  });

  return `attendance:phase-completion-snapshot:${familyKey}`;
}

export function buildStudentPhaseCompletionStatus(input: {
  phaseOneDone: boolean;
  phaseTwoDone: boolean;
}): StudentPhaseCompletion {
  const overallPresent = input.phaseOneDone && input.phaseTwoDone;
  let pendingPhase: PendingPhase = null;
  if (!overallPresent) {
    pendingPhase = input.phaseOneDone ? "PHASE_TWO" : "PHASE_ONE";
  }

  return {
    phaseOneDone: input.phaseOneDone,
    phaseTwoDone: input.phaseTwoDone,
    overallPresent,
    pendingPhase,
  };
}

function getFreshPhaseCompletionSnapshot(cacheKey: string) {
  const cached = phaseCompletionSnapshotCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAtMs <= Date.now()) {
    phaseCompletionSnapshotCache.delete(cacheKey);
    return null;
  }

  return cached.snapshot;
}

function buildPhaseCompletionFromFlags(flags: number) {
  return buildStudentPhaseCompletionStatus({
    phaseOneDone: Boolean(flags & PHASE_ONE_FLAG),
    phaseTwoDone: Boolean(flags & PHASE_TWO_FLAG),
  });
}

async function getPhaseCompletionSnapshot(input: {
  sessionFamilyId?: string | null;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}) {
  const cacheKey = buildPhaseCompletionSnapshotCacheKey(input);
  const cached = getFreshPhaseCompletionSnapshot(cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = phaseCompletionSnapshotInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const queryPromise = (async () => {
    const dayRange = getUtcDayRange(input.referenceTime);
    const rows =
      typeof input.sessionFamilyId === "string" && input.sessionFamilyId.trim().length > 0
        ? await db.attendanceRecord.findMany({
            where: {
              session: {
                sessionFamilyId: input.sessionFamilyId.trim(),
              },
            },
            select: {
              studentId: true,
              session: {
                select: {
                  sessionFlow: true,
                  phase: true,
                },
              },
            },
          })
        : await db.attendanceRecord.findMany({
            where: {
              session: {
                courseId: input.courseId,
                ...(input.lecturerId ? { lecturerId: input.lecturerId } : {}),
                startedAt: {
                  gte: dayRange.start,
                  lt: dayRange.end,
                },
              },
            },
            select: {
              studentId: true,
              session: {
                select: {
                  sessionFlow: true,
                  phase: true,
                },
              },
            },
          });

    const snapshot: Record<string, number> = {};
    for (const row of rows) {
      const historicalPhase = getHistoricalPhaseFromSession({
        sessionFlow: row.session.sessionFlow,
        phase: row.session.phase,
      });
      const currentFlags = snapshot[row.studentId] ?? 0;
      snapshot[row.studentId] =
        historicalPhase === "PHASE_ONE"
          ? currentFlags | PHASE_ONE_FLAG
          : currentFlags | PHASE_TWO_FLAG;
    }

    phaseCompletionSnapshotCache.set(cacheKey, {
      expiresAtMs: Date.now() + PHASE_COMPLETION_SNAPSHOT_TTL_MS,
      snapshot,
    });

    return snapshot;
  })();

  phaseCompletionSnapshotInFlight.set(cacheKey, queryPromise);

  try {
    return await queryPromise;
  } finally {
    phaseCompletionSnapshotInFlight.delete(cacheKey);
  }
}

export async function prewarmPhaseCompletionSnapshotForCourseDay(input: {
  sessionFamilyId?: string | null;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}) {
  await getPhaseCompletionSnapshot(input);
}

export async function getStudentPhaseCompletionForCourseDay(input: {
  studentId: string;
  sessionFamilyId?: string | null;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}): Promise<StudentPhaseCompletion> {
  const snapshotCacheKey = buildPhaseCompletionSnapshotCacheKey(input);
  const localSnapshot = getFreshPhaseCompletionSnapshot(snapshotCacheKey);
  if (localSnapshot) {
    return buildPhaseCompletionFromFlags(localSnapshot[input.studentId] ?? 0);
  }

  const cacheKey = buildPhaseCompletionCacheKey(input);
  const cached = await cacheGet<StudentPhaseCompletion>(cacheKey);
  if (cached) {
    return cached;
  }

  const snapshot = await getPhaseCompletionSnapshot(input);
  const result = buildPhaseCompletionFromFlags(snapshot[input.studentId] ?? 0);
  await cacheSet(cacheKey, result, 300);
  return result;
}

export async function getStudentPhaseCompletionForSession(input: {
  studentId: string;
  sessionId: string;
}): Promise<StudentPhaseCompletion | null> {
  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id: input.sessionId },
    select: {
      sessionFamilyId: true,
      courseId: true,
      lecturerId: true,
      startedAt: true,
    },
  });

  if (!attendanceSession || !attendanceSession.startedAt) return null;

  return getStudentPhaseCompletionForCourseDay({
    studentId: input.studentId,
    sessionFamilyId: attendanceSession.sessionFamilyId,
    courseId: attendanceSession.courseId,
    lecturerId: attendanceSession.lecturerId,
    referenceTime: attendanceSession.startedAt,
  });
}

export async function invalidateStudentPhaseCompletionForCourseDay(input: {
  studentId: string;
  sessionFamilyId?: string | null;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}) {
  await cacheDel(buildPhaseCompletionCacheKey(input));
}

export async function setStudentPhaseCompletionForCourseDay(
  input: {
    studentId: string;
    sessionFamilyId?: string | null;
    courseId: string;
    lecturerId?: string | null;
    referenceTime: Date;
  },
  value: StudentPhaseCompletion
) {
  await cacheSet(buildPhaseCompletionCacheKey(input), value, 300);

  const snapshotKey = buildPhaseCompletionSnapshotCacheKey(input);
  const cachedSnapshot = getFreshPhaseCompletionSnapshot(snapshotKey);
  if (cachedSnapshot) {
    let flags = 0;
    if (value.phaseOneDone) {
      flags |= PHASE_ONE_FLAG;
    }
    if (value.phaseTwoDone) {
      flags |= PHASE_TWO_FLAG;
    }
    cachedSnapshot[input.studentId] = flags;
  }
}
