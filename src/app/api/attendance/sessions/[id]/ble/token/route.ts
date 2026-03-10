import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import { generateQrPayloadForSequence, getQrSequence } from "@/lib/qr";
import { cacheGet, cacheSet } from "@/lib/cache";
import type { BleTokenPayload } from "@/lib/ble-spec";
import { getSessionBleBroadcast } from "@/lib/lecturer-ble";

type TokenResponse = {
  sessionId: string;
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  phaseEndsAt: string;
  rotationMs: number;
  current: BleTokenPayload;
  next: BleTokenPayload;
  serverNowTs: number;
  nextRotationAtTs: number;
};

function buildTokenPayload(input: {
  sessionId: string;
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  qrSecret: string;
  sequence: number;
  rotationMs: number;
  phaseEndsAt: Date;
  ts: number;
}): BleTokenPayload {
  const qr = generateQrPayloadForSequence(
    input.sessionId,
    input.qrSecret,
    input.phase,
    input.sequence,
    input.rotationMs,
    input.ts
  );

  return {
    sessionId: input.sessionId,
    phase: input.phase,
    sequence: input.sequence,
    token: qr.token,
    ts: qr.ts,
    tokenTimestamp: qr.ts,
    rotationMs: input.rotationMs,
    phaseEndsAt: input.phaseEndsAt.toISOString(),
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "LECTURER") {
    return NextResponse.json(
      { error: "Only lecturers can fetch BLE token stream" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    select: {
      id: true,
      lecturerId: true,
      relayEnabled: true,
      qrSecret: true,
    },
  });

  if (!attendanceSession || attendanceSession.lecturerId !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!attendanceSession.relayEnabled) {
    return NextResponse.json(
      { error: "BLE mode is disabled for this session." },
      { status: 403 }
    );
  }

  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession || syncedSession.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Session is no longer active" },
      { status: 410 }
    );
  }

  const bleBroadcast = await getSessionBleBroadcast(id);
  if (!bleBroadcast) {
    return NextResponse.json(
      { error: "BLE beacon is not enabled for this session." },
      { status: 403 }
    );
  }

  const nowTs = Date.now();
  const currentSequence = getQrSequence(nowTs, syncedSession.qrRotationMs);
  const cacheKey = `attendance:ble-token:${id}:${syncedSession.phase}:${currentSequence}`;
  const cached = await cacheGet<TokenResponse>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const phaseEndsAt = getPhaseEndsAt(syncedSession);
  const nextSequence = currentSequence + 1;
  const nextRotationAtTs = nextSequence * syncedSession.qrRotationMs;

  const payload: TokenResponse = {
    sessionId: id,
    phase: syncedSession.phase,
    phaseEndsAt: phaseEndsAt.toISOString(),
    rotationMs: syncedSession.qrRotationMs,
    current: buildTokenPayload({
      sessionId: id,
      phase: syncedSession.phase,
      qrSecret: attendanceSession.qrSecret,
      sequence: currentSequence,
      rotationMs: syncedSession.qrRotationMs,
      phaseEndsAt,
      ts: nowTs,
    }),
    next: buildTokenPayload({
      sessionId: id,
      phase: syncedSession.phase,
      qrSecret: attendanceSession.qrSecret,
      sequence: nextSequence,
      rotationMs: syncedSession.qrRotationMs,
      phaseEndsAt,
      ts: nextRotationAtTs,
    }),
    serverNowTs: nowTs,
    nextRotationAtTs,
  };

  await cacheSet(cacheKey, payload, 2);
  return NextResponse.json(payload);
}
