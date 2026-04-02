import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import { generateQrPayload } from "@/lib/qr";
import {
  getLecturerOwnedSessionsForDeletion,
  invalidateAttendanceSessionCaches,
} from "@/lib/attendance-session-management";
import { clearSessionBleBroadcast } from "@/lib/lecturer-ble";

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

  const courseEnrollmentCount = await db.enrollment.count({
    where: { courseId: attendanceSession.courseId },
  });

  const user = session.user as any;
  const isLecturer = attendanceSession.lecturerId === user.id;
  const isAdminInOrganization =
    user.role === "ADMIN" &&
    Boolean(user.organizationId) &&
    user.organizationId === attendanceSession.course.organizationId;
  const isSuperAdmin = user.role === "SUPER_ADMIN";

  if (!isLecturer && !isAdminInOrganization && !isSuperAdmin) {
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
    courseEnrollmentCount,
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

  await invalidateAttendanceSessionCaches([
    {
      id,
      lecturerId: user.id,
      courseId: attendanceSession.courseId,
    },
  ]);

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; role: string };
  if (user.role !== "LECTURER") {
    return NextResponse.json(
      { error: "Only lecturers can delete attendance sessions" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const { sessions, missingIds, activeIds } = await getLecturerOwnedSessionsForDeletion(
    user.id,
    [id]
  );

  if (missingIds.length > 0 || sessions.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (activeIds.length > 0) {
    return NextResponse.json(
      { error: "Active sessions must be ended before deletion.", activeSessionIds: activeIds },
      { status: 409 }
    );
  }

  await db.attendanceSession.delete({
    where: { id },
  });

  await invalidateAttendanceSessionCaches(sessions);

  return NextResponse.json({
    success: true,
    deletedSessionIds: [id],
  });
}
