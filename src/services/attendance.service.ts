import { db } from "@/lib/db";

export async function getAttendanceReport(courseId: string) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: {
      sessions: {
        include: {
          records: {
            include: {
              student: { select: { id: true, name: true, studentId: true } },
            },
          },
        },
        orderBy: { startedAt: "asc" },
      },
      enrollments: {
        include: {
          student: { select: { id: true, name: true, studentId: true } },
        },
      },
    },
  });

  if (!course) return null;

  const students = course.enrollments.map((e) => e.student);
  const sessions = course.sessions;

  const report = students.map((student) => {
    const attended = sessions.filter((s) =>
      s.records.some((r) => r.studentId === student.id)
    ).length;
    const percentage =
      sessions.length > 0
        ? Math.round((attended / sessions.length) * 100)
        : 0;

    return {
      studentId: student.studentId,
      name: student.name,
      sessionsAttended: attended,
      totalSessions: sessions.length,
      percentage,
    };
  });

  return {
    course: { code: course.code, name: course.name },
    totalSessions: sessions.length,
    totalStudents: students.length,
    report: report.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getOrganizationAnalytics(organizationId: string) {
  const [
    totalStudents,
    totalLecturers,
    totalCourses,
    totalSessions,
    totalRecords,
    flaggedRecords,
    recentSessions,
  ] = await Promise.all([
    db.user.count({ where: { organizationId, role: "STUDENT" } }),
    db.user.count({ where: { organizationId, role: "LECTURER" } }),
    db.course.count({ where: { organizationId } }),
    db.attendanceSession.count({
      where: { course: { organizationId } },
    }),
    db.attendanceRecord.count({
      where: { session: { course: { organizationId } } },
    }),
    db.attendanceRecord.count({
      where: { session: { course: { organizationId } }, flagged: true },
    }),
    db.attendanceSession.findMany({
      where: { course: { organizationId } },
      include: {
        course: true,
        _count: { select: { records: true } },
      },
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
  ]);

  const avgConfidence = await db.attendanceRecord.aggregate({
    where: { session: { course: { organizationId } } },
    _avg: { confidence: true },
  });

  return {
    totalStudents,
    totalLecturers,
    totalCourses,
    totalSessions,
    totalRecords,
    flaggedRecords,
    avgConfidence: Math.round(avgConfidence._avg.confidence || 0),
    recentSessions: recentSessions.map((s) => ({
      id: s.id,
      course: `${s.course.code} - ${s.course.name}`,
      date: s.startedAt.toISOString(),
      students: s._count.records,
      status: s.status,
    })),
  };
}
