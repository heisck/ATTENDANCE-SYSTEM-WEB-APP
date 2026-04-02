import { cacheDel, CACHE_KEYS } from "@/lib/cache";
import { syncAttendanceSessionState } from "@/lib/attendance";
import { db } from "@/lib/db";
import { clearSessionBleBroadcast } from "@/lib/lecturer-ble";

type SessionCacheTarget = {
  id: string;
  lecturerId: string;
  courseId: string;
};

const SESSION_LIST_TAKES = [20, 100] as const;

function getLecturerSessionListCacheKeys(lecturerId: string) {
  return [
    `attendance:sessions:list:LECTURER:${lecturerId}:ACTIVE`,
    `attendance:sessions:list:LECTURER:${lecturerId}:ALL`,
    `attendance:sessions:list:LECTURER:${lecturerId}:CLOSED`,
    ...SESSION_LIST_TAKES.flatMap((take) => [
      `attendance:sessions:list:LECTURER:${lecturerId}:ACTIVE:${take}`,
      `attendance:sessions:list:LECTURER:${lecturerId}:ALL:${take}`,
      `attendance:sessions:list:LECTURER:${lecturerId}:CLOSED:${take}`,
    ]),
  ];
}

function getStudentSessionListCacheKeys(studentId: string) {
  return [
    `attendance:sessions:list:STUDENT:${studentId}:ACTIVE`,
    `attendance:sessions:list:STUDENT:${studentId}:ALL`,
    `attendance:sessions:list:STUDENT:${studentId}:CLOSED`,
    ...SESSION_LIST_TAKES.flatMap((take) => [
      `attendance:sessions:list:STUDENT:${studentId}:ACTIVE:${take}`,
      `attendance:sessions:list:STUDENT:${studentId}:ALL:${take}`,
      `attendance:sessions:list:STUDENT:${studentId}:CLOSED:${take}`,
    ]),
    `student:live-sessions:${studentId}`,
  ];
}

export async function invalidateAttendanceSessionCaches(
  targets: SessionCacheTarget[]
): Promise<void> {
  if (targets.length === 0) {
    return;
  }

  const dedupedTargets = Array.from(
    new Map(targets.map((target) => [target.id, target])).values()
  );
  const courseIds = Array.from(new Set(dedupedTargets.map((target) => target.courseId)));
  const lecturerIds = Array.from(new Set(dedupedTargets.map((target) => target.lecturerId)));

  const enrollmentRows = await db.enrollment.findMany({
    where: { courseId: { in: courseIds } },
    select: { courseId: true, studentId: true },
  });

  const studentsByCourse = new Map<string, string[]>();
  for (const row of enrollmentRows) {
    const current = studentsByCourse.get(row.courseId) ?? [];
    current.push(row.studentId);
    studentsByCourse.set(row.courseId, current);
  }

  const cacheKeys = new Set<string>();

  for (const lecturerId of lecturerIds) {
    for (const key of getLecturerSessionListCacheKeys(lecturerId)) {
      cacheKeys.add(key);
    }
  }

  for (const target of dedupedTargets) {
    cacheKeys.add(`attendance:session-meta:${target.id}`);
    cacheKeys.add(`attendance:session-secret:${target.id}`);
    cacheKeys.add(`attendance:mark-session:${target.id}`);
    cacheKeys.add(CACHE_KEYS.SESSION_STATE(target.id));

    const studentIds = studentsByCourse.get(target.courseId) ?? [];
    for (const studentId of studentIds) {
      cacheKeys.add(`attendance:session-me:${target.id}:${studentId}`);
      cacheKeys.add(`attendance:qr-port-status:${target.id}:${studentId}`);
      for (const key of getStudentSessionListCacheKeys(studentId)) {
        cacheKeys.add(key);
      }
    }
  }

  await Promise.all([
    ...Array.from(cacheKeys, (key) => cacheDel(key)),
    ...dedupedTargets.map((target) => clearSessionBleBroadcast(target.id)),
  ]);
}

export async function getLecturerOwnedSessionsForDeletion(
  lecturerId: string,
  sessionIds: string[]
): Promise<{
  sessions: SessionCacheTarget[];
  missingIds: string[];
  activeIds: string[];
}> {
  const uniqueSessionIds = Array.from(
    new Set(
      sessionIds
        .map((sessionId) => sessionId.trim())
        .filter((sessionId) => sessionId.length > 0)
    )
  );

  if (uniqueSessionIds.length === 0) {
    return { sessions: [], missingIds: [], activeIds: [] };
  }

  const sessions = await db.attendanceSession.findMany({
    where: {
      id: { in: uniqueSessionIds },
      lecturerId,
    },
    select: {
      id: true,
      lecturerId: true,
      courseId: true,
    },
  });

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const missingIds: string[] = [];
  const activeIds: string[] = [];

  await Promise.all(
    uniqueSessionIds.map(async (sessionId) => {
      const session = sessionsById.get(sessionId);
      if (!session) {
        missingIds.push(sessionId);
        return;
      }

      const synced = await syncAttendanceSessionState(sessionId);
      if (!synced) {
        missingIds.push(sessionId);
        sessionsById.delete(sessionId);
        return;
      }

      if (synced.status === "ACTIVE") {
        activeIds.push(sessionId);
      }
    })
  );

  return {
    sessions: uniqueSessionIds
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is SessionCacheTarget => Boolean(session)),
    missingIds,
    activeIds,
  };
}
