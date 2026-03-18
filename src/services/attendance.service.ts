import { db } from "@/lib/db";

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

function getUtcDayKey(reference: Date) {
  return getUtcDayRange(reference).start.toISOString().slice(0, 10);
}

export async function getAttendanceReport(courseId: string) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: {
      sessions: {
        include: {
          records: {
            include: {
              student: {
                select: {
                  id: true,
                  name: true,
                  studentId: true,
                  indexNumber: true,
                },
              },
            },
          },
        },
        orderBy: { startedAt: "asc" },
      },
      enrollments: {
        include: {
          student: {
            select: {
              id: true,
              name: true,
              studentId: true,
              indexNumber: true,
            },
          },
        },
      },
    },
  });

  if (!course) return null;

  const students = course.enrollments.map((e) => e.student);
  const sessions = course.sessions;
  const dayMap = new Map<
    string,
    {
      date: string;
      phaseOneSessions: number;
      phaseTwoSessions: number;
      studentPhases: Map<string, { phaseOneDone: boolean; phaseTwoDone: boolean }>;
    }
  >();

  for (const session of sessions) {
    const dayKey = getUtcDayKey(session.startedAt);
    let dayEntry = dayMap.get(dayKey);

    if (!dayEntry) {
      dayEntry = {
        date: dayKey,
        phaseOneSessions: 0,
        phaseTwoSessions: 0,
        studentPhases: new Map(),
      };
      dayMap.set(dayKey, dayEntry);
    }

    if (session.phase === "PHASE_ONE") {
      dayEntry.phaseOneSessions += 1;
    } else if (session.phase === "PHASE_TWO") {
      dayEntry.phaseTwoSessions += 1;
    }

    for (const record of session.records) {
      const current =
        dayEntry.studentPhases.get(record.studentId) ??
        {
          phaseOneDone: false,
          phaseTwoDone: false,
        };

      if (session.phase === "PHASE_ONE") {
        current.phaseOneDone = true;
      } else if (session.phase === "PHASE_TWO") {
        current.phaseTwoDone = true;
      }

      dayEntry.studentPhases.set(record.studentId, current);
    }
  }

  const days = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const totalClassDays = days.length;

  const report = students.map((student) => {
    let phaseOneDays = 0;
    let phaseTwoDays = 0;
    let fullyPresentDays = 0;

    for (const day of days) {
      const status = day.studentPhases.get(student.id);
      if (!status) {
        continue;
      }

      if (status.phaseOneDone) {
        phaseOneDays += 1;
      }

      if (status.phaseTwoDone) {
        phaseTwoDays += 1;
      }

      if (status.phaseOneDone && status.phaseTwoDone) {
        fullyPresentDays += 1;
      }
    }

    const percentage =
      totalClassDays > 0
        ? Math.round((fullyPresentDays / totalClassDays) * 100)
        : 0;

    return {
      studentId: student.studentId,
      indexNumber: student.indexNumber,
      name: student.name,
      phaseOneDays,
      phaseTwoDays,
      fullyPresentDays,
      totalClassDays,
      sessionsAttended: fullyPresentDays,
      totalSessions: totalClassDays,
      percentage,
    };
  });

  return {
    scope: "course" as const,
    course: { id: course.id, code: course.code, name: course.name },
    totalSessions: sessions.length,
    totalClassDays,
    totalStudents: students.length,
    days: days.map((day) => {
      let phaseOneMarked = 0;
      let phaseTwoMarked = 0;
      let fullyPresent = 0;

      for (const status of day.studentPhases.values()) {
        if (status.phaseOneDone) {
          phaseOneMarked += 1;
        }
        if (status.phaseTwoDone) {
          phaseTwoMarked += 1;
        }
        if (status.phaseOneDone && status.phaseTwoDone) {
          fullyPresent += 1;
        }
      }

      return {
        date: day.date,
        phaseOneSessions: day.phaseOneSessions,
        phaseTwoSessions: day.phaseTwoSessions,
        phaseOneMarked,
        phaseTwoMarked,
        fullyPresent,
      };
    }),
    report: report.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getAttendanceSessionReport(sessionId: string) {
  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    include: {
      course: true,
      records: {
        include: {
          student: {
            select: {
              id: true,
              name: true,
              studentId: true,
              indexNumber: true,
            },
          },
        },
        orderBy: { markedAt: "asc" },
      },
      _count: {
        select: {
          records: true,
        },
      },
    },
  });

  if (!attendanceSession) {
    return null;
  }

  const [{ start, end }, totalEnrolled, sameDaySessions] = await Promise.all([
    Promise.resolve(getUtcDayRange(attendanceSession.startedAt)),
    db.enrollment.count({
      where: { courseId: attendanceSession.courseId },
    }),
    db.attendanceSession.findMany({
      where: {
        courseId: attendanceSession.courseId,
        startedAt: {
          gte: getUtcDayRange(attendanceSession.startedAt).start,
          lt: getUtcDayRange(attendanceSession.startedAt).end,
        },
      },
      select: {
        id: true,
        phase: true,
        startedAt: true,
      },
      orderBy: { startedAt: "asc" },
    }),
  ]);

  const samePhaseSessions = sameDaySessions.filter(
    (row) => row.phase === attendanceSession.phase
  );
  const phaseRunNumber = Math.max(
    1,
    samePhaseSessions.findIndex((row) => row.id === attendanceSession.id) + 1
  );
  const phaseOneSessionCount = sameDaySessions.filter(
    (row) => row.phase === "PHASE_ONE"
  ).length;

  const phaseLabel =
    attendanceSession.phase === "PHASE_ONE" ? "Phase 1" : "Phase 2";
  const sessionKind =
    attendanceSession.phase === "PHASE_ONE"
      ? phaseRunNumber > 1
        ? `Phase 1 Extension ${phaseRunNumber - 1}`
        : "Phase 1 Opening"
      : phaseRunNumber > 1
        ? `Phase 2 Extension ${phaseRunNumber - 1}`
        : phaseOneSessionCount > 0
          ? "Phase 2 Closing"
          : "Phase 2 Session";

  return {
    scope: "session" as const,
    session: {
      id: attendanceSession.id,
      courseId: attendanceSession.courseId,
      courseCode: attendanceSession.course.code,
      courseName: attendanceSession.course.name,
      date: start.toISOString().slice(0, 10),
      startedAt: attendanceSession.startedAt.toISOString(),
      status: attendanceSession.status,
      phase: attendanceSession.phase,
      phaseLabel,
      sessionKind,
      phaseRunNumber,
      totalEnrolled,
      totalStudentsMarked: attendanceSession._count.records,
    },
    records: attendanceSession.records.map((record) => ({
      studentId: record.student.studentId,
      indexNumber: record.student.indexNumber,
      name: record.student.name,
      markedAt: record.markedAt.toISOString(),
      confidence: record.confidence,
      flagged: record.flagged,
    })),
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
