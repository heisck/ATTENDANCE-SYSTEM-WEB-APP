import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import { generateQrPayload, getNextRotationMs } from "@/lib/qr";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const user = session.user as any;
  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    select: { id: true, lecturerId: true, qrSecret: true },
  });

  if (!attendanceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (attendanceSession.lecturerId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (syncedSession.status !== "ACTIVE") {
    return NextResponse.json({ error: "Session is closed" }, { status: 410 });
  }

  const qr = generateQrPayload(
    attendanceSession.id,
    attendanceSession.qrSecret,
    syncedSession.phase,
    syncedSession.qrRotationMs
  );
  const nextRotation = getNextRotationMs(syncedSession.qrRotationMs);

  return NextResponse.json({
    qr,
    phase: syncedSession.phase,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
    nextRotationMs: nextRotation,
  });
}
