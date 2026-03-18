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
  clearBleBroadcasterPresence,
  clearBleRelayLease,
  clearSessionBleBroadcast,
  getBleBroadcasterPresence,
  getFreshBleRelayLease,
  getSessionBleBroadcast,
  setBleRelayLease,
  setBleBroadcasterPresence,
  setSessionBleBroadcast,
} from "@/lib/lecturer-ble";
import { updateRelayBroadcastState } from "@/lib/ble-relay";

type BleAction = "start" | "stop" | "heartbeat";

function isValidBleAction(value: unknown): value is BleAction {
  return value === "start" || value === "stop" || value === "heartbeat";
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
        enabled: false,
        active: false,
        beaconName: null,
        startedAt: null,
        expiresAt: null,
        lastHeartbeatAt: null,
        serviceUuid: ATTENDANCE_BLE.SERVICE_UUID,
        currentTokenCharacteristicUuid: ATTENDANCE_BLE.CURRENT_TOKEN_CHAR_UUID,
        sessionMetaCharacteristicUuid: ATTENDANCE_BLE.SESSION_META_CHAR_UUID,
        manufacturerCompanyId: ATTENDANCE_BLE.MANUFACTURER_COMPANY_ID,
        manufacturerDataHex: null,
        phase: syncedSession.phase,
        phaseEndsAt: getPhaseEndsAt(syncedSession),
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
  const relayLease = await getFreshBleRelayLease(id);
  const manufacturerDataHex = buildAttendanceManufacturerDataHex({
    courseCode: attendanceSession.course.code,
    sessionId: attendanceSession.id,
    phase: syncedSession.phase,
  });
  return NextResponse.json({
    enabled: Boolean(broadcast),
    active: Boolean(heartbeat && relayLease),
    beaconName: broadcast?.beaconName ?? null,
    startedAt: broadcast?.startedAt ?? null,
    expiresAt: broadcast?.expiresAt ?? null,
    lastHeartbeatAt: heartbeat?.lastHeartbeatAt ?? null,
    broadcasterDeviceName: heartbeat?.deviceName ?? null,
    relayLeaseActive: Boolean(relayLease),
    serviceUuid: ATTENDANCE_BLE.SERVICE_UUID,
    currentTokenCharacteristicUuid: ATTENDANCE_BLE.CURRENT_TOKEN_CHAR_UUID,
    sessionMetaCharacteristicUuid: ATTENDANCE_BLE.SESSION_META_CHAR_UUID,
    manufacturerCompanyId: ATTENDANCE_BLE.MANUFACTURER_COMPANY_ID,
    manufacturerDataHex,
    phase: syncedSession.phase,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "LECTURER") {
    return NextResponse.json(
      { error: "Only lecturers can manage BLE broadcast" },
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
      course: {
        select: {
          code: true,
        },
      },
    },
  });

  if (!attendanceSession || attendanceSession.lecturerId !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Malformed JSON request body." },
      { status: 400 }
    );
  }
  const requestedAction =
    typeof body.action === "string" ? body.action.toLowerCase() : "start";
  const action: BleAction = isValidBleAction(requestedAction)
    ? requestedAction
    : "start";

  if (action === "stop") {
    await clearSessionBleBroadcast(id);
    await clearBleRelayLease(id);
    await updateRelayBroadcastState(id);
    await db.attendanceSession.update({
      where: { id },
      data: {
        relayEnabled: false,
      },
    });

    return NextResponse.json({
      success: true,
      enabled: false,
      active: false,
      beaconName: null,
      startedAt: null,
      expiresAt: null,
      lastHeartbeatAt: null,
      serviceUuid: ATTENDANCE_BLE.SERVICE_UUID,
      currentTokenCharacteristicUuid: ATTENDANCE_BLE.CURRENT_TOKEN_CHAR_UUID,
      sessionMetaCharacteristicUuid: ATTENDANCE_BLE.SESSION_META_CHAR_UUID,
      manufacturerCompanyId: ATTENDANCE_BLE.MANUFACTURER_COMPANY_ID,
      manufacturerDataHex: null,
    });
  }

  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession || syncedSession.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Session is no longer active" },
      { status: 410 }
    );
  }

  const phaseEndsAt = getPhaseEndsAt(syncedSession);
  const beaconName = buildDefaultBeaconName({
    courseCode: attendanceSession.course.code,
    sessionId: attendanceSession.id,
    phase: syncedSession.phase,
  });
  const manufacturerDataHex = buildAttendanceManufacturerDataHex({
    courseCode: attendanceSession.course.code,
    sessionId: attendanceSession.id,
    phase: syncedSession.phase,
  });

  const existingBroadcast = await getSessionBleBroadcast(id);
  const shouldRefreshBroadcast =
    action === "start" ||
    !existingBroadcast ||
    existingBroadcast.beaconName !== beaconName;
  const broadcast = shouldRefreshBroadcast
    ? await setSessionBleBroadcast(id, {
        lecturerId: user.id,
        beaconName,
        startedAt:
          action === "heartbeat" && existingBroadcast
            ? new Date(existingBroadcast.startedAt)
            : new Date(),
        expiresAt: phaseEndsAt,
      })
    : await setSessionBleBroadcast(id, {
        lecturerId: user.id,
        beaconName: existingBroadcast.beaconName,
        startedAt: new Date(existingBroadcast.startedAt),
        expiresAt: phaseEndsAt,
      });

  if (!attendanceSession.relayEnabled) {
    await db.attendanceSession.update({
      where: { id },
      data: {
        relayEnabled: true,
        relayOpenTime: new Date(),
      },
    });
  }

  if (action === "heartbeat") {
    const heartbeat = await setBleBroadcasterPresence(id, {
      deviceId:
        typeof body.deviceId === "string" && body.deviceId.trim().length > 0
          ? body.deviceId
          : "android-broadcaster",
      deviceName:
        typeof body.deviceName === "string" && body.deviceName.trim().length > 0
          ? body.deviceName
          : "Android Broadcaster",
      platform:
        typeof body.platform === "string" && body.platform.trim().length > 0
          ? body.platform
          : "android",
      appVersion:
        typeof body.appVersion === "string" && body.appVersion.trim().length > 0
          ? body.appVersion
          : null,
    });
    const relayLease = await setBleRelayLease(id, {
      lecturerId: user.id,
      deviceId: heartbeat.deviceId,
      deviceName: heartbeat.deviceName,
      platform: heartbeat.platform,
      appVersion: heartbeat.appVersion,
      beaconName: broadcast.beaconName,
      phase: syncedSession.phase,
      lastHeartbeatAt: heartbeat.lastHeartbeatAt,
      expiresAt: phaseEndsAt,
    });
    await updateRelayBroadcastState(id);

    return NextResponse.json({
      success: true,
      enabled: true,
      active: true,
      beaconName: broadcast.beaconName,
      startedAt: broadcast.startedAt,
      expiresAt: broadcast.expiresAt,
      lastHeartbeatAt: heartbeat.lastHeartbeatAt,
      relayLeaseActive: true,
      relayLeaseExpiresAt: relayLease.expiresAt,
      serviceUuid: ATTENDANCE_BLE.SERVICE_UUID,
      currentTokenCharacteristicUuid: ATTENDANCE_BLE.CURRENT_TOKEN_CHAR_UUID,
      sessionMetaCharacteristicUuid: ATTENDANCE_BLE.SESSION_META_CHAR_UUID,
      manufacturerCompanyId: ATTENDANCE_BLE.MANUFACTURER_COMPANY_ID,
      manufacturerDataHex,
      phase: syncedSession.phase,
      phaseEndsAt,
    });
  }

  await clearBleBroadcasterPresence(id);
  await clearBleRelayLease(id);
  await updateRelayBroadcastState(id);
  return NextResponse.json({
    success: true,
    enabled: true,
    active: false,
    beaconName: broadcast.beaconName,
    startedAt: broadcast.startedAt,
    expiresAt: broadcast.expiresAt,
    lastHeartbeatAt: null,
    relayLeaseActive: false,
    serviceUuid: ATTENDANCE_BLE.SERVICE_UUID,
    currentTokenCharacteristicUuid: ATTENDANCE_BLE.CURRENT_TOKEN_CHAR_UUID,
    sessionMetaCharacteristicUuid: ATTENDANCE_BLE.SESSION_META_CHAR_UUID,
    manufacturerCompanyId: ATTENDANCE_BLE.MANUFACTURER_COMPANY_ID,
    manufacturerDataHex,
    phase: syncedSession.phase,
    phaseEndsAt,
  });
}
