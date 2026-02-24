import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type CourseStat = {
  courseId: string;
  totalSessions: number;
  attended: number;
  missed: number;
  attendanceRate: number;
};

function buildCourseStats(
  courseIds: string[],
  sessions: { id: string; courseId: string; startedAt: Date }[],
  records: { sessionId: string }[]
): CourseStat[] {
  const recordsBySessionId = new Set(records.map((record) => record.sessionId));
  const sessionsByCourse = new Map<string, { id: string; startedAt: Date }[]>();

  for (const courseId of courseIds) {
    sessionsByCourse.set(courseId, []);
  }
  for (const sessionRow of sessions) {
    const bucket = sessionsByCourse.get(sessionRow.courseId);
    if (bucket) bucket.push({ id: sessionRow.id, startedAt: sessionRow.startedAt });
  }

  return courseIds.map((courseId) => {
    const grouped = sessionsByCourse.get(courseId) ?? [];
    const totalSessions = grouped.length;
    let attended = 0;
    for (const row of grouped) {
      if (recordsBySessionId.has(row.id)) attended += 1;
    }

    const missed = Math.max(totalSessions - attended, 0);
    const attendanceRate = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;
    return {
      courseId,
      totalSessions,
      attended,
      missed,
      attendanceRate,
    };
  });
}

export async function runReminderEngine() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
  const sixHoursAhead = new Date(now.getTime() + 1000 * 60 * 60 * 6);
  const oneDayAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24);
  const twelveHoursAgo = new Date(now.getTime() - 1000 * 60 * 60 * 12);

  let notificationsCreated = 0;

  // Get all students with their enrollments and courses in one optimized query
  const students = await db.user.findMany({
    where: {
      role: "STUDENT",
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
      enrollments: {
        select: {
          courseId: true,
          course: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });

  // Get all sessions in a single query
  const allSessions = await db.attendanceSession.findMany({
    where: {
      startedAt: { gte: thirtyDaysAgo, lte: now },
    },
    select: {
      id: true,
      courseId: true,
      startedAt: true,
    },
  });

  // Get all attendance records for the period in one query
  const allRecords = await db.attendanceRecord.findMany({
    where: {
      sessionId: { in: allSessions.map((s) => s.id) },
    },
    select: {
      studentId: true,
      sessionId: true,
    },
  });

  // Index records by student and session for fast lookup
  const recordsByStudent = new Map<string, Set<string>>();
  for (const record of allRecords) {
    if (!recordsByStudent.has(record.studentId)) {
      recordsByStudent.set(record.studentId, new Set());
    }
    recordsByStudent.get(record.studentId)!.add(record.sessionId);
  }

  // Get existing notifications in one query to avoid duplicates
  const existingNotifications = await db.userNotification.findMany({
    where: {
      type: { in: ["ATTENDANCE_RISK", "UPCOMING_CLASS"] },
      createdAt: { gte: oneDayAgo },
    },
    select: {
      userId: true,
      type: true,
      metadata: true,
    },
  });

  // Index existing notifications by student and type
  const existingByKey = new Map<string, boolean>();
  for (const notif of existingNotifications) {
    const courseId = (notif.metadata as any)?.courseId;
    if (courseId) {
      const key = `${notif.userId}:${notif.type}:${courseId}`;
      existingByKey.set(key, true);
    }
  }

  // Batch all notifications to create
  const notificationsToCreate: Prisma.UserNotificationCreateManyInput[] = [];

  // Process each student
  for (const student of students) {
    if (student.enrollments.length === 0) continue;

    const courseIds = student.enrollments.map((e) => e.courseId);
    const studentSessions = allSessions.filter((s) => courseIds.includes(s.courseId));

    if (studentSessions.length === 0) continue;

    const studentRecords = recordsByStudent.get(student.id) ?? new Set();

    // Build stats for this student
    const stats = buildCourseStats(courseIds, studentSessions, 
      Array.from(studentRecords).map(sessionId => ({ sessionId }))
    );

    // Generate attendance risk notifications
    const atRiskCourses = stats.filter(
      (entry) =>
        entry.totalSessions > 0 &&
        (entry.attendanceRate < 75 || entry.missed >= 2)
    );

    for (const risk of atRiskCourses) {
      const courseInfo = student.enrollments.find(
        (e) => e.courseId === risk.courseId
      )?.course;
      if (!courseInfo) continue;

      const key = `${student.id}:ATTENDANCE_RISK:${courseInfo.id}`;
      if (existingByKey.has(key)) continue;

      notificationsToCreate.push({
        userId: student.id,
        type: "ATTENDANCE_RISK",
        title: `Attendance risk for ${courseInfo.code}`,
        body: `Your attendance is ${risk.attendanceRate}% with ${risk.missed} missed classes in the last 30 days.`,
        sentAt: now,
        metadata: {
          courseId: courseInfo.id,
          courseCode: courseInfo.code,
          attendanceRate: risk.attendanceRate,
          missed: risk.missed,
        },
      });
    }

    // Generate upcoming class notifications
    const latestByCourse = new Map<
      string,
      { id: string; code: string; name: string; startedAt: Date }
    >();

    for (const session of studentSessions) {
      if (!latestByCourse.has(session.courseId)) {
        const courseInfo = student.enrollments.find(
          (e) => e.courseId === session.courseId
        )?.course;
        if (courseInfo) {
          latestByCourse.set(session.courseId, {
            id: courseInfo.id,
            code: courseInfo.code,
            name: courseInfo.name,
            startedAt: session.startedAt,
          });
        }
      }
    }

    for (const latest of latestByCourse.values()) {
      const nextLikely = new Date(latest.startedAt);
      while (nextLikely <= now) {
        nextLikely.setDate(nextLikely.getDate() + 7);
      }
      if (nextLikely > sixHoursAhead) continue;

      const key = `${student.id}:UPCOMING_CLASS:${latest.id}`;
      if (existingByKey.has(key)) continue;

      notificationsToCreate.push({
        userId: student.id,
        type: "UPCOMING_CLASS",
        title: `Upcoming class: ${latest.code}`,
        body: `Expected around ${nextLikely.toLocaleTimeString()} based on recent attendance trends.`,
        sentAt: now,
        metadata: {
          courseId: latest.id,
          courseCode: latest.code,
          nextLikelyAt: nextLikely.toISOString(),
        },
      });
    }
  }

  // Batch create all notifications in one operation
  if (notificationsToCreate.length > 0) {
    await db.userNotification.createMany({
      data: notificationsToCreate,
    });
    notificationsCreated = notificationsToCreate.length;
  }

  return {
    organizationsProcessed: new Set(students.map((s) => s.organizationId)).size,
    studentsProcessed: students.length,
    notificationsCreated,
  };
}
