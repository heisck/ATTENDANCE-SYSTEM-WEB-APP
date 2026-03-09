import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import {
  ATTENDANCE_BLE,
  buildAttendanceManufacturerDataHex,
} from "@/lib/ble-spec";
import {
  buildDefaultBeaconName,
  clearSessionBleBroadcast,
  getBleBroadcasterPresence,
  getSessionBleBroadcast,
  setSessionBleBroadcast,
} from "@/lib/lecturer-ble";

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

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    select: {
      id: true,
      lecturerId: true,
      relayEnabled: true,
      relayOpenTime: true,
      startedAt: true,
      course: {
        select: {
          code: true,
          enrollments: {
            where: { studentId: user.id },
            select: { id: true },
          },
        },
      },
    },
  });
  if (!attendanceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const isLecturer = attendanceSession.lecturerId === user.id;
  const isStudent = attendanceSession.course.enrollments.length > 0;
  if (!isLecturer && !isStudent) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (syncedSession.status !== "ACTIVE") {
    await clearSessionBleBroadcast(id);
    return NextResponse.json(
      {
        error: "Session is no longer active",
        active: false,
        enabled: false,
        expectedBeaconName: null,
        namePrefix: ATTENDANCE_BLE.NAME_PREFIX,
        serviceUuid: ATTENDANCE_BLE.SERVICE_UUID,
        currentTokenCharacteristicUuid: ATTENDANCE_BLE.CURRENT_TOKEN_CHAR_UUID,
        sessionMetaCharacteristicUuid: ATTENDANCE_BLE.SESSION_META_CHAR_UUID,
        manufacturerCompanyId: ATTENDANCE_BLE.MANUFACTURER_COMPANY_ID,
        manufacturerDataHex: null,
        phase: syncedSession.phase,
        phaseEndsAt: getPhaseEndsAt(syncedSession),
        rotationMs: syncedSession.qrRotationMs,
      },
      { status: 410 }
    );
  }

  let broadcast = await getSessionBleBroadcast(id);
  if (!broadcast && attendanceSession.relayEnabled) {
    const phaseEndsAt = getPhaseEndsAt(syncedSession);
    const recoveredName = buildDefaultBeaconName({
      courseCode: attendanceSession.course.code,
      sessionId: attendanceSession.id,
      phase: syncedSession.phase,
    });
    broadcast = await setSessionBleBroadcast(id, {
      lecturerId: attendanceSession.lecturerId,
      beaconName: recoveredName,
      startedAt: attendanceSession.relayOpenTime ?? attendanceSession.startedAt,
      expiresAt: phaseEndsAt,
    });
  }

  const heartbeat = await getBleBroadcasterPresence(id);
  const manufacturerDataHex = buildAttendanceManufacturerDataHex({
    courseCode: attendanceSession.course.code,
    sessionId: attendanceSession.id,
    phase: syncedSession.phase,
  });
  return NextResponse.json({
    active: Boolean(heartbeat),
    enabled: Boolean(broadcast),
    expectedBeaconName: broadcast?.beaconName ?? null,
    namePrefix: ATTENDANCE_BLE.NAME_PREFIX,
    serviceUuid: ATTENDANCE_BLE.SERVICE_UUID,
    currentTokenCharacteristicUuid: ATTENDANCE_BLE.CURRENT_TOKEN_CHAR_UUID,
    sessionMetaCharacteristicUuid: ATTENDANCE_BLE.SESSION_META_CHAR_UUID,
    manufacturerCompanyId: ATTENDANCE_BLE.MANUFACTURER_COMPANY_ID,
    manufacturerDataHex,
    phase: syncedSession.phase,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
    rotationMs: syncedSession.qrRotationMs,
    lastHeartbeatAt: heartbeat?.lastHeartbeatAt ?? null,
  });
}
