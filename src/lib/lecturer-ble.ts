import { cacheDel, cacheGet, cacheSet } from "./cache";
import { ATTENDANCE_BLE, buildAttendanceBeaconName } from "./ble-spec";
import type { BleAttendancePhase } from "./ble-spec";

export type SessionBleBroadcast = {
  sessionId: string;
  lecturerId: string;
  beaconName: string;
  startedAt: string;
  expiresAt: string;
};

export type BleBroadcasterPresence = {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  appVersion: string | null;
  lastHeartbeatAt: string;
};

function normalizeBeaconName(input: string): string {
  return input.trim().replace(/\s+/g, " ").slice(0, 48);
}

export function buildDefaultBeaconName(input: {
  courseCode: string;
  sessionId: string;
  phase: BleAttendancePhase;
}): string {
  return normalizeBeaconName(buildAttendanceBeaconName(input));
}

function key(sessionId: string) {
  return `attendance:lecturer-ble:${sessionId}`;
}

function heartbeatKey(sessionId: string) {
  return `attendance:lecturer-ble-heartbeat:${sessionId}`;
}

export async function getSessionBleBroadcast(
  sessionId: string
): Promise<SessionBleBroadcast | null> {
  const payload = await cacheGet<SessionBleBroadcast>(key(sessionId));
  if (!payload) return null;

  const expiresAtMs = new Date(payload.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    await clearSessionBleBroadcast(sessionId);
    return null;
  }
  return payload;
}

export async function setSessionBleBroadcast(
  sessionId: string,
  input: {
    lecturerId: string;
    beaconName: string;
    startedAt: Date;
    expiresAt: Date;
  }
): Promise<SessionBleBroadcast> {
  const payload: SessionBleBroadcast = {
    sessionId,
    lecturerId: input.lecturerId,
    beaconName: normalizeBeaconName(input.beaconName),
    startedAt: input.startedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  };

  const ttlSeconds = Math.max(
    5,
    Math.ceil((input.expiresAt.getTime() - Date.now()) / 1000)
  );
  await cacheSet(key(sessionId), payload, ttlSeconds);
  return payload;
}

export async function clearSessionBleBroadcast(sessionId: string): Promise<void> {
  await Promise.all([
    cacheDel(key(sessionId)),
    cacheDel(heartbeatKey(sessionId)),
  ]);
}

export async function getBleBroadcasterPresence(
  sessionId: string
): Promise<BleBroadcasterPresence | null> {
  return cacheGet<BleBroadcasterPresence>(heartbeatKey(sessionId));
}

export async function setBleBroadcasterPresence(
  sessionId: string,
  input: {
    deviceId: string;
    deviceName: string;
    platform: string;
    appVersion?: string | null;
  }
): Promise<BleBroadcasterPresence> {
  const payload: BleBroadcasterPresence = {
    sessionId,
    deviceId: input.deviceId.trim().slice(0, 120),
    deviceName: input.deviceName.trim().slice(0, 120) || "Unknown Broadcaster",
    platform: input.platform.trim().slice(0, 40) || "android",
    appVersion: input.appVersion?.trim().slice(0, 40) ?? null,
    lastHeartbeatAt: new Date().toISOString(),
  };

  await cacheSet(
    heartbeatKey(sessionId),
    payload,
    ATTENDANCE_BLE.BROADCASTER_HEARTBEAT_TTL_SECONDS
  );
  return payload;
}

export async function clearBleBroadcasterPresence(sessionId: string): Promise<void> {
  await cacheDel(heartbeatKey(sessionId));
}
