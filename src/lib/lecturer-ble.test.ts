import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheGetMock = vi.fn();
const cacheSetMock = vi.fn();
const cacheDelMock = vi.fn();

vi.mock("./cache", () => ({
  cacheGet: cacheGetMock,
  cacheSet: cacheSetMock,
  cacheDel: cacheDelMock,
}));

const { ATTENDANCE_BLE } = await import("./ble-spec");
const {
  getBleRelayLease,
  getFreshBleRelayLease,
  setBleRelayLease,
} = await import("./lecturer-ble");

describe("lecturer-ble relay lease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps the lease to the heartbeat window when writing the cache", async () => {
    const now = new Date("2026-03-17T10:00:00.000Z");
    vi.setSystemTime(now);

    await setBleRelayLease("session-1", {
      lecturerId: "lecturer-1",
      deviceId: "device-1",
      deviceName: "Broadcaster",
      platform: "android",
      appVersion: "1.0.0",
      beaconName: "ATD-COURSE-P1-1234",
      phase: "PHASE_ONE",
      lastHeartbeatAt: now.toISOString(),
      expiresAt: new Date("2026-03-17T11:00:00.000Z"),
    });

    expect(cacheSetMock).toHaveBeenCalledTimes(1);
    const [, storedLease, ttlSeconds] = cacheSetMock.mock.calls[0];
    expect(storedLease.sessionId).toBe("session-1");
    expect(ttlSeconds).toBe(ATTENDANCE_BLE.BROADCASTER_HEARTBEAT_TTL_SECONDS);
  });

  it("returns the lease only when the broadcaster heartbeat matches", async () => {
    const now = new Date("2026-03-17T10:00:00.000Z");
    vi.setSystemTime(now);

    const lease = {
      sessionId: "session-1",
      lecturerId: "lecturer-1",
      deviceId: "device-1",
      deviceName: "Broadcaster",
      platform: "android",
      appVersion: "1.0.0",
      beaconName: "ATD-COURSE-P1-1234",
      phase: "PHASE_ONE",
      lastHeartbeatAt: now.toISOString(),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 20_000).toISOString(),
    };

    cacheGetMock.mockImplementation((key: string) => {
      if (key.includes("attendance:lecturer-ble-lease:session-1")) {
        return lease;
      }
      if (key.includes("attendance:lecturer-ble-heartbeat:session-1")) {
        return {
          sessionId: "session-1",
          deviceId: "device-1",
          deviceName: "Broadcaster",
          platform: "android",
          appVersion: "1.0.0",
          lastHeartbeatAt: now.toISOString(),
        };
      }
      return null;
    });

    await expect(getBleRelayLease("session-1")).resolves.toEqual(lease);
    await expect(getFreshBleRelayLease("session-1")).resolves.toEqual(lease);

    cacheGetMock.mockImplementation((key: string) => {
      if (key.includes("attendance:lecturer-ble-lease:session-1")) {
        return lease;
      }
      return null;
    });

    await expect(getFreshBleRelayLease("session-1")).resolves.toBeNull();
    expect(cacheDelMock).toHaveBeenCalledWith(
      "attendance:lecturer-ble-lease:session-1"
    );
  });
});
