import { db } from "@/lib/db";
import {
  formatSessionKind,
  getHistoricalPhaseFromSession,
  resolveSessionFamilyKey,
} from "@/lib/session-flow";

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

function formatCohortLabel(input: {
  displayName: string;
  department: string;
  level: number;
  groupCode: string;
} | null) {
  if (!input) {
    return null;
  }

  return (
    input.displayName ||
    `${input.department} Level ${input.level} ${input.groupCode}`
  );
}

function compareStudentRows<
  T extends {
    name: string;
    studentId: string | null;
    indexNumber: string | null;
    email?: string | null;
  },
>(a: T, b: T) {
  return (
    a.name.localeCompare(b.name) ||
    (a.studentId || "").localeCompare(b.studentId || "") ||
    (a.indexNumber || "").localeCompare(b.indexNumber || "") ||
    (a.email || "").localeCompare(b.email || "")
  );
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
              email: true,
              studentId: true,
              indexNumber: true,
              cohort: {
                select: {
                  displayName: true,
                  department: true,
                  level: true,
                  groupCode: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!course) return null;

  const students = course.enrollments.map((e) => e.student);
  const sessions = course.sessions;
  const sessionFamilyMap = new Map<
    string,
    {
      familyKey: string;
      date: string;
      startedAt: Date;
      phaseOneSessions: number;
      phaseTwoSessions: number;
      studentPhases: Map<string, { phaseOneDone: boolean; phaseTwoDone: boolean }>;
    }
  >();

  for (const session of sessions) {
    const familyKey = resolveSessionFamilyKey({
      sessionFamilyId: session.sessionFamilyId,
      courseId: session.courseId,
      lecturerId: session.lecturerId,
      startedAt: session.startedAt,
    });
    let familyEntry = sessionFamilyMap.get(familyKey);

    if (!familyEntry) {
      familyEntry = {
        familyKey,
        date: getUtcDayKey(session.startedAt),
        startedAt: session.startedAt,
        phaseOneSessions: 0,
        phaseTwoSessions: 0,
        studentPhases: new Map(),
      };
      sessionFamilyMap.set(familyKey, familyEntry);
    } else if (session.startedAt < familyEntry.startedAt) {
      familyEntry.startedAt = session.startedAt;
      familyEntry.date = getUtcDayKey(session.startedAt);
    }

    const historicalPhase = getHistoricalPhaseFromSession({
      sessionFlow: session.sessionFlow,
      phase: session.phase,
    });

    if (historicalPhase === "PHASE_ONE") {
      familyEntry.phaseOneSessions += 1;
    } else if (historicalPhase === "PHASE_TWO") {
      familyEntry.phaseTwoSessions += 1;
    }

    for (const record of session.records) {
      const current =
        familyEntry.studentPhases.get(record.studentId) ??
        {
          phaseOneDone: false,
          phaseTwoDone: false,
        };

      if (historicalPhase === "PHASE_ONE") {
        current.phaseOneDone = true;
      } else if (historicalPhase === "PHASE_TWO") {
        current.phaseTwoDone = true;
      }

      familyEntry.studentPhases.set(record.studentId, current);
    }
  }

  const sessionFamilies = Array.from(sessionFamilyMap.values()).sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
  );
  const totalClassDays = sessionFamilies.length;

  const report = students.map((student) => {
    let phaseOneDays = 0;
    let phaseTwoDays = 0;
    let fullyPresentDays = 0;

    for (const sessionFamily of sessionFamilies) {
      const status = sessionFamily.studentPhases.get(student.id);
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
      email: student.email,
      studentId: student.studentId,
      indexNumber: student.indexNumber,
      name: student.name,
      cohort: formatCohortLabel(student.cohort),
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
    days: sessionFamilies.map((sessionFamily) => {
      let phaseOneMarked = 0;
      let phaseTwoMarked = 0;
      let fullyPresent = 0;

      for (const status of sessionFamily.studentPhases.values()) {
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
        date: sessionFamily.date,
        phaseOneSessions: sessionFamily.phaseOneSessions,
        phaseTwoSessions: sessionFamily.phaseTwoSessions,
        phaseOneMarked,
        phaseTwoMarked,
        fullyPresent,
      };
    }),
    report: report.sort(compareStudentRows),
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
              email: true,
              studentId: true,
              indexNumber: true,
              cohort: {
                select: {
                  displayName: true,
                  department: true,
                  level: true,
                  groupCode: true,
                },
              },
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

  const dayRange = getUtcDayRange(attendanceSession.startedAt);
  const [totalEnrolled, relatedSessions] = await Promise.all([
    db.enrollment.count({
      where: { courseId: attendanceSession.courseId },
    }),
    attendanceSession.sessionFamilyId
      ? db.attendanceSession.findMany({
          where: {
            courseId: attendanceSession.courseId,
            sessionFamilyId: attendanceSession.sessionFamilyId,
          },
          select: {
            id: true,
            sessionFlow: true,
            phase: true,
            startedAt: true,
          },
          orderBy: { startedAt: "asc" },
        })
      : db.attendanceSession.findMany({
          where: {
            courseId: attendanceSession.courseId,
            startedAt: {
              gte: dayRange.start,
              lt: dayRange.end,
            },
          },
          select: {
            id: true,
            sessionFlow: true,
            phase: true,
            startedAt: true,
          },
          orderBy: { startedAt: "asc" },
        }),
  ]);

  const samePhaseSessions = relatedSessions.filter(
    (row) =>
      getHistoricalPhaseFromSession({
        sessionFlow: row.sessionFlow,
        phase: row.phase,
      }) ===
      getHistoricalPhaseFromSession({
        sessionFlow: attendanceSession.sessionFlow,
        phase: attendanceSession.phase,
      })
  );
  const phaseRunNumber = Math.max(
    1,
    samePhaseSessions.findIndex((row) => row.id === attendanceSession.id) + 1
  );
  const phaseOneSessionCount = relatedSessions.filter(
    (row) =>
      getHistoricalPhaseFromSession({
        sessionFlow: row.sessionFlow,
        phase: row.phase,
      }) === "PHASE_ONE"
  ).length;

  const historicalPhase = getHistoricalPhaseFromSession({
    sessionFlow: attendanceSession.sessionFlow,
    phase: attendanceSession.phase,
  });
  const phaseLabel =
    historicalPhase === "PHASE_ONE"
      ? "Phase 1"
      : historicalPhase === "PHASE_TWO"
        ? "Phase 2"
        : "Closed";
  const sessionKind = formatSessionKind({
    sessionFlow: attendanceSession.sessionFlow,
    phase: historicalPhase,
    phaseRunNumber,
    phaseOneSessionCount,
  });

  return {
    scope: "session" as const,
    session: {
      id: attendanceSession.id,
      courseId: attendanceSession.courseId,
      courseCode: attendanceSession.course.code,
      courseName: attendanceSession.course.name,
      date: dayRange.start.toISOString().slice(0, 10),
      startedAt: attendanceSession.startedAt.toISOString(),
      status: attendanceSession.status,
      phase: historicalPhase,
      phaseLabel,
      sessionKind,
      phaseRunNumber,
      totalEnrolled,
      totalStudentsMarked: attendanceSession._count.records,
    },
    records: attendanceSession.records
      .map((record) => ({
        email: record.student.email,
        studentId: record.student.studentId,
        indexNumber: record.student.indexNumber,
        name: record.student.name,
        cohort: formatCohortLabel(record.student.cohort),
        markedAt: record.markedAt.toISOString(),
        confidence: record.confidence,
        flagged: record.flagged,
      }))
      .sort(compareStudentRows),
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
