import { db } from "@/lib/db";

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
  const organizations = await db.organization.findMany({
    select: {
      id: true,
    },
  });

  let notificationsCreated = 0;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
  const sixHoursAhead = new Date(now.getTime() + 1000 * 60 * 60 * 6);

  for (const org of organizations) {
    const students = await db.user.findMany({
      where: {
        organizationId: org.id,
        role: "STUDENT",
      },
      select: { id: true, name: true },
    });

    for (const student of students) {
      const enrollments = await db.enrollment.findMany({
        where: { studentId: student.id },
        include: {
          course: { select: { id: true, code: true, name: true } },
        },
      });

      if (enrollments.length === 0) continue;
      const courseIds = enrollments.map((entry) => entry.courseId);

      const sessions = await db.attendanceSession.findMany({
        where: {
          courseId: { in: courseIds },
          startedAt: { gte: thirtyDaysAgo, lte: now },
        },
        select: {
          id: true,
          courseId: true,
          startedAt: true,
        },
      });

      const records = await db.attendanceRecord.findMany({
        where: {
          studentId: student.id,
          sessionId: { in: sessions.map((row) => row.id) },
        },
        select: { sessionId: true },
      });

      const stats = buildCourseStats(courseIds, sessions, records);
      const atRiskCourses = stats.filter((entry) => entry.totalSessions > 0 && (entry.attendanceRate < 75 || entry.missed >= 2));
      for (const risk of atRiskCourses) {
        const courseInfo = enrollments.find((entry) => entry.courseId === risk.courseId)?.course;
        if (!courseInfo) continue;

        const existingRisk = await db.userNotification.findFirst({
          where: {
            userId: student.id,
            type: "ATTENDANCE_RISK",
            createdAt: {
              gte: new Date(now.getTime() - 1000 * 60 * 60 * 24),
            },
            metadata: {
              path: ["courseId"],
              equals: courseInfo.id,
            },
          },
          select: { id: true },
        });
        if (existingRisk) continue;

        await db.userNotification.create({
          data: {
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
          },
        });
        notificationsCreated += 1;
      }

      const predictedCourses = await db.attendanceSession.findMany({
        where: {
          courseId: { in: courseIds },
          startedAt: { gte: thirtyDaysAgo, lte: now },
        },
        select: {
          courseId: true,
          startedAt: true,
          course: { select: { id: true, code: true, name: true } },
        },
        orderBy: { startedAt: "desc" },
      });

      const latestByCourse = new Map<
        string,
        { id: string; code: string; name: string; startedAt: Date }
      >();
      for (const row of predictedCourses) {
        if (!latestByCourse.has(row.courseId)) {
          latestByCourse.set(row.courseId, {
            id: row.course.id,
            code: row.course.code,
            name: row.course.name,
            startedAt: row.startedAt,
          });
        }
      }

      for (const latest of latestByCourse.values()) {
        const nextLikely = new Date(latest.startedAt);
        while (nextLikely <= now) {
          nextLikely.setDate(nextLikely.getDate() + 7);
        }
        if (nextLikely > sixHoursAhead) continue;

        const existingUpcoming = await db.userNotification.findFirst({
          where: {
            userId: student.id,
            type: "UPCOMING_CLASS",
            createdAt: {
              gte: new Date(now.getTime() - 1000 * 60 * 60 * 12),
            },
            metadata: {
              path: ["courseId"],
              equals: latest.id,
            },
          },
          select: { id: true },
        });
        if (existingUpcoming) continue;

        await db.userNotification.create({
          data: {
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
          },
        });
        notificationsCreated += 1;
      }
    }
  }

  return {
    organizations: organizations.length,
    notificationsCreated,
  };
}
