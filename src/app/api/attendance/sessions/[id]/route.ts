import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import { generateQrPayload } from "@/lib/qr";

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
    phase: syncedSession.phase,
    initialEndsAt: syncedSession.initialEndsAt,
    reverifyEndsAt: syncedSession.reverifyEndsAt,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
    reverifySelectionDone: syncedSession.reverifySelectionDone,
    reverifySelectedCount: syncedSession.reverifySelectedCount,
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
  });

  if (!attendanceSession || attendanceSession.lecturerId !== user.id) {
    return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
  }

  const updated = await db.attendanceSession.update({
    where: { id },
    data: { status: "CLOSED", phase: "CLOSED", closedAt: new Date() },
  });

  return NextResponse.json(updated);
}
