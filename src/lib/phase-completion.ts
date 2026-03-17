import { db } from "@/lib/db";
import { cacheDel, cacheGet, cacheSet } from "@/lib/cache";

export type PendingPhase = "PHASE_ONE" | "PHASE_TWO" | null;

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
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}) {
  const { start } = getUtcDayRange(input.referenceTime);
  const dayKey = start.toISOString().slice(0, 10);
  return `attendance:phase-completion:${input.studentId}:${input.courseId}:${input.lecturerId ?? "all"}:${dayKey}`;
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

export async function getStudentPhaseCompletionForCourseDay(input: {
  studentId: string;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}): Promise<StudentPhaseCompletion> {
  const cacheKey = buildPhaseCompletionCacheKey(input);
  const cached = await cacheGet<StudentPhaseCompletion>(cacheKey);
  if (cached) {
    return cached;
  }

  const { start, end } = getUtcDayRange(input.referenceTime);
  const rows = await db.attendanceSession.findMany({
    where: {
      courseId: input.courseId,
      ...(input.lecturerId ? { lecturerId: input.lecturerId } : {}),
      startedAt: {
        gte: start,
        lt: end,
      },
      records: {
        some: {
          studentId: input.studentId,
        },
      },
    },
    select: {
      phase: true,
    },
    distinct: ["phase"],
  });

  const phaseOneDone = rows.some((row) => row.phase === "PHASE_ONE");
  const phaseTwoDone = rows.some((row) => row.phase === "PHASE_TWO");

  const result = buildStudentPhaseCompletionStatus({ phaseOneDone, phaseTwoDone });
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
      courseId: true,
      lecturerId: true,
      startedAt: true,
    },
  });

  if (!attendanceSession || !attendanceSession.startedAt) return null;

  return getStudentPhaseCompletionForCourseDay({
    studentId: input.studentId,
    courseId: attendanceSession.courseId,
    lecturerId: attendanceSession.lecturerId,
    referenceTime: attendanceSession.startedAt,
  });
}

export async function invalidateStudentPhaseCompletionForCourseDay(input: {
  studentId: string;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}) {
  await cacheDel(buildPhaseCompletionCacheKey(input));
}
