import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import {
  formatQrSequenceId,
  generateQrPayloadForSequence,
  getQrSequence,
} from "@/lib/qr";
import { cacheGet, cacheGetOrCompute, cacheSet } from "@/lib/cache";

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

  const attendanceSession = await cacheGetOrCompute(
    `attendance:session-meta:${id}`,
    120,
    async () =>
      db.attendanceSession.findUnique({
        where: { id },
        select: { id: true, lecturerId: true, qrSecret: true },
      })
  );

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
  const currentSequence = getQrSequence(nowTs, syncedSession.qrRotationMs);
  const sequenceCacheKey = `attendance:qr:${attendanceSession.id}:${syncedSession.phase}:${currentSequence}`;
  const cachedQr = await cacheGet<any>(sequenceCacheKey);
  if (cachedQr) {
    return NextResponse.json(cachedQr);
  }

  const nextRotationAtTs = (currentSequence + 1) * syncedSession.qrRotationMs;
  const nextRotation = Math.max(0, nextRotationAtTs - nowTs);
  const qr = generateQrPayloadForSequence(
    attendanceSession.id,
    attendanceSession.qrSecret,
    syncedSession.phase,
    currentSequence,
    syncedSession.qrRotationMs
  );
  const nextSequence = currentSequence + 1;
  const nextQr = generateQrPayloadForSequence(
    attendanceSession.id,
    attendanceSession.qrSecret,
    syncedSession.phase,
    nextSequence,
    syncedSession.qrRotationMs,
    nextRotationAtTs
  );
  const sequenceId = formatQrSequenceId(currentSequence);
  const nextSequenceId = formatQrSequenceId(nextSequence);
  const cueColor = syncedSession.phase === "PHASE_TWO" ? "blue" : "green";

  const payload = {
    qr,
    nextQr,
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
  };
  await cacheSet(sequenceCacheKey, payload, 2);
  return NextResponse.json(payload);
}
