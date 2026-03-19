import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import { generateQrPayload } from "@/lib/qr";
import { CACHE_KEYS, cacheDel } from "@/lib/cache";
import { clearSessionBleBroadcast } from "@/lib/lecturer-ble";

async function invalidateClosedSessionCaches(sessionId: string, lecturerId: string, courseId: string) {
  const enrollmentRows = await db.enrollment.findMany({
    where: { courseId },
    select: { studentId: true },
  });

  await Promise.all([
    cacheDel(`attendance:session-meta:${sessionId}`),
    cacheDel(`attendance:session-secret:${sessionId}`),
    cacheDel(`attendance:mark-session:${sessionId}`),
    cacheDel(CACHE_KEYS.SESSION_STATE(sessionId)),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ACTIVE`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ALL`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:CLOSED`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ACTIVE:20`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ALL:20`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:CLOSED:20`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ACTIVE:100`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ALL:100`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:CLOSED:100`),
    ...enrollmentRows.flatMap((row) => [
      cacheDel(`attendance:session-me:${sessionId}:${row.studentId}`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ACTIVE`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ALL`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:CLOSED`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ACTIVE:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ALL:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:CLOSED:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ACTIVE:100`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ALL:100`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:CLOSED:100`),
      cacheDel(`student:live-sessions:${row.studentId}`),
    ]),
  ]);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    include: {
      course: true,
      records: {
        include: {
          student: { select: { id: true, name: true, studentId: true } },
        },
        orderBy: { markedAt: "desc" },
      },
      _count: { select: { records: true } },
    },
  });

  if (!attendanceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const user = session.user as any;
  const isLecturer = attendanceSession.lecturerId === user.id;
  const isPrivileged = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

  if (!isLecturer && !isPrivileged) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let qr = null;
  if (isLecturer && syncedSession.status === "ACTIVE") {
    qr = generateQrPayload(
      attendanceSession.id,
      attendanceSession.qrSecret,
      syncedSession.phase,
      syncedSession.qrRotationMs
    );
  }

  return NextResponse.json({
    ...attendanceSession,
    status: syncedSession.status,
    phase: syncedSession.phase,
    endsAt: syncedSession.endsAt,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
    qrSecret: undefined,
    qr,
  });
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const user = session.user as any;

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    select: {
      id: true,
      courseId: true,
      lecturerId: true,
    },
  });

  if (!attendanceSession || attendanceSession.lecturerId !== user.id) {
    return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
  }

  const updated = await db.attendanceSession.update({
    where: { id },
    data: {
      status: "CLOSED",
      phase: "CLOSED",
      closedAt: new Date(),
      relayEnabled: false,
    },
  });

  try {
    await clearSessionBleBroadcast(id);
  } catch (error) {
    console.error("Failed to clear BLE broadcast during session close:", error);
  }

  await invalidateClosedSessionCaches(id, user.id, attendanceSession.courseId);

  return NextResponse.json(updated);
}
