import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import {
  formatQrSequenceId,
  generateQrPayload,
  getQrSequence,
} from "@/lib/qr";

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

  const nowTs = Date.now();
  const qr = generateQrPayload(
    attendanceSession.id,
    attendanceSession.qrSecret,
    syncedSession.phase,
    syncedSession.qrRotationMs,
    nowTs
  );
  const currentSequence = getQrSequence(nowTs, syncedSession.qrRotationMs);
  const nextRotationAtTs = (currentSequence + 1) * syncedSession.qrRotationMs;
  const nextRotation = Math.max(0, nextRotationAtTs - nowTs);
  const sequenceId = formatQrSequenceId(qr.seq);
  const nextSequence = qr.seq + 1;
  const nextSequenceId = formatQrSequenceId(nextSequence);
  const cueColor = syncedSession.phase === "REVERIFY" ? "blue" : "green";

  return NextResponse.json({
    qr,
    sequence: qr.seq,
    sequenceId,
    nextSequence,
    nextSequenceId,
    upcomingSequenceIds: [
      nextSequenceId,
      formatQrSequenceId(nextSequence + 1),
    ],
    cueColor,
    phase: syncedSession.phase,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
    rotationMs: syncedSession.qrRotationMs,
    nextRotationMs: nextRotation,
    nextRotationAtTs,
    serverNowTs: nowTs,
  });
}
