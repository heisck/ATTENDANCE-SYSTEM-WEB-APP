"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  AttendanceBleBroadcaster,
  isNativeAndroidBleBroadcasterAvailable,
} from "@/lib/native-ble-broadcaster";

type LecturerBleSyncProps = {
  sessionId: string;
  sessionActive: boolean;
  enabled: boolean;
  beaconName: string | null;
  serviceUuid: string;
  currentTokenCharacteristicUuid: string;
  sessionMetaCharacteristicUuid: string;
};

type BleTokenResponse = {
  sessionId: string;
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  phaseEndsAt: string;
  rotationMs: number;
  current: {
    sessionId: string;
    phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
    sequence: number;
    token: string;
    ts: number;
    tokenTimestamp: number;
    rotationMs: number;
    phaseEndsAt: string;
  };
};

const BROADCASTER_DEVICE_STORAGE_KEY = "attendanceiq:lecturer-ble-broadcaster:v1";
const HEARTBEAT_INTERVAL_MS = 10_000;
const TOKEN_SYNC_INTERVAL_MS = 2_000;

function getOrCreateBroadcasterDeviceToken() {
  if (typeof window === "undefined") return "android-broadcaster";

  const existing = window.localStorage.getItem(BROADCASTER_DEVICE_STORAGE_KEY);
  if (existing && existing.trim().length > 0) {
    return existing.trim();
  }

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `android-${crypto.randomUUID()}`
      : `android-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  window.localStorage.setItem(BROADCASTER_DEVICE_STORAGE_KEY, generated);
  return generated;
}

export function LecturerBleBroadcasterSync({
  sessionId,
  sessionActive,
  enabled,
  beaconName,
  serviceUuid,
  currentTokenCharacteristicUuid,
  sessionMetaCharacteristicUuid,
}: LecturerBleSyncProps) {
  const lastErrorRef = useRef<string>("");
  const lastHeartbeatAtRef = useRef<number>(0);
  const syncInFlightRef = useRef(false);
  const haltSyncRef = useRef(false);

  useEffect(() => {
    if (!isNativeAndroidBleBroadcasterAvailable()) {
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    async function stopNativeBroadcast(silent: boolean) {
      try {
        await AttendanceBleBroadcaster.stopBroadcast();
      } catch (error: any) {
        if (!silent) {
          const message = error?.message || "Failed to stop Android BLE broadcaster.";
          if (message !== lastErrorRef.current) {
            toast.error(message);
            lastErrorRef.current = message;
          }
        }
      }
    }

    async function syncNativeBroadcast() {
        if (
          cancelled ||
          haltSyncRef.current ||
          syncInFlightRef.current ||
          !sessionActive ||
          !enabled ||
          !beaconName ||
        !serviceUuid ||
        !currentTokenCharacteristicUuid ||
        !sessionMetaCharacteristicUuid
      ) {
        return;
      }

      syncInFlightRef.current = true;
      try {
        const tokenResponse = await fetch(`/api/attendance/sessions/${sessionId}/ble/token`, {
          cache: "no-store",
        });
        const tokenBody = (await tokenResponse.json().catch(() => null)) as BleTokenResponse | {
          error?: string;
        } | null;

        if (!tokenResponse.ok || !tokenBody || !("current" in tokenBody)) {
          throw new Error(tokenBody?.error || "Failed to fetch BLE token stream.");
        }

        const sessionMetaPayload = JSON.stringify({
          sessionId: tokenBody.sessionId,
          phase: tokenBody.phase,
          rotationMs: tokenBody.rotationMs,
          phaseEndsAt: tokenBody.phaseEndsAt,
          beaconName,
        });

        const nativeStatus = await AttendanceBleBroadcaster.startBroadcast({
          beaconName,
          serviceUuid,
          currentTokenCharacteristicUuid,
          sessionMetaCharacteristicUuid,
          currentTokenPayload: JSON.stringify(tokenBody.current),
          sessionMetaPayload,
        });

        if (
          nativeStatus.active &&
          Date.now() - lastHeartbeatAtRef.current >= HEARTBEAT_INTERVAL_MS
        ) {
          const heartbeatResponse = await fetch(`/api/attendance/sessions/${sessionId}/ble`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "heartbeat",
              deviceId: getOrCreateBroadcasterDeviceToken(),
              deviceName: nativeStatus.deviceName?.trim() || beaconName,
              platform: "android",
              appVersion: "capacitor-android",
            }),
          });

          const heartbeatBody = await heartbeatResponse.json().catch(() => null);
          if (!heartbeatResponse.ok) {
            throw new Error(
              heartbeatBody?.error || "Failed to update BLE broadcaster heartbeat."
            );
          }

          lastHeartbeatAtRef.current = Date.now();
        }

        lastErrorRef.current = "";
      } catch (error: any) {
        if (cancelled) return;

        const message = error?.message || "Android BLE broadcaster failed.";
        if (message !== lastErrorRef.current) {
          toast.error(message);
          lastErrorRef.current = message;
        }

        if (
          /permissions are required|permission|turned off|does not support|unavailable on this device/i.test(
            message
          )
        ) {
          haltSyncRef.current = true;
        }

        if (
          /session is no longer active|ble mode is disabled|beacon is not enabled/i.test(message)
        ) {
          await stopNativeBroadcast(true);
        }
      } finally {
        syncInFlightRef.current = false;
      }
    }

    if (
      !sessionActive ||
      !enabled ||
      !beaconName ||
      !serviceUuid ||
      !currentTokenCharacteristicUuid ||
      !sessionMetaCharacteristicUuid
    ) {
      lastHeartbeatAtRef.current = 0;
      void stopNativeBroadcast(true);
      return;
    }

    haltSyncRef.current = false;
    void syncNativeBroadcast();
    intervalId = window.setInterval(() => {
      void syncNativeBroadcast();
    }, TOKEN_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      syncInFlightRef.current = false;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      lastHeartbeatAtRef.current = 0;
      haltSyncRef.current = false;
      void stopNativeBroadcast(true);
    };
  }, [
    beaconName,
    currentTokenCharacteristicUuid,
    enabled,
    serviceUuid,
    sessionActive,
    sessionId,
    sessionMetaCharacteristicUuid,
  ]);

  return null;
}
