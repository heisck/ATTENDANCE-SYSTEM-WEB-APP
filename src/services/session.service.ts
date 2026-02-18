import { db } from "@/lib/db";

export async function getActiveSessions(organizationId: string) {
  return db.attendanceSession.findMany({
    where: {
      status: "ACTIVE",
      course: { organizationId },
    },
    include: {
      course: true,
      lecturer: { select: { name: true } },
      _count: { select: { records: true } },
    },
  });
}

export async function getSessionDetail(sessionId: string) {
  return db.attendanceSession.findUnique({
    where: { id: sessionId },
    include: {
      course: {
        include: {
          _count: { select: { enrollments: true } },
        },
      },
      lecturer: { select: { name: true, email: true } },
      records: {
        include: {
          student: {
            select: { id: true, name: true, studentId: true, email: true },
          },
        },
        orderBy: { markedAt: "asc" },
      },
    },
  });
}
