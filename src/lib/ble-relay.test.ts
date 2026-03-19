import { beforeEach, describe, expect, it, vi } from "vitest";

const bleRelayDeviceFindUniqueMock = vi.fn();
const attendanceSessionFindUniqueMock = vi.fn();
const attendanceRecordFindFirstMock = vi.fn();
const relayAttendanceRecordFindUniqueMock = vi.fn();
const relayAttendanceRecordCreateMock = vi.fn();
const bleRelayDeviceUpdateMock = vi.fn();
const getFreshBleRelayLeaseMock = vi.fn();
const verifyQrTokenStrictMock = vi.fn();
const deriveAttendancePhaseMock = vi.fn();

vi.mock("./db", () => ({
  db: {
    bleRelayDevice: {
      findUnique: bleRelayDeviceFindUniqueMock,
      update: bleRelayDeviceUpdateMock,
    },
    attendanceSession: {
      findUnique: attendanceSessionFindUniqueMock,
    },
    attendanceRecord: {
      findFirst: attendanceRecordFindFirstMock,
      findUnique: vi.fn(),
    },
    relayAttendanceRecord: {
      findUnique: relayAttendanceRecordFindUniqueMock,
      create: relayAttendanceRecordCreateMock,
    },
  },
}));

vi.mock("./lecturer-ble", () => ({
  getFreshBleRelayLease: getFreshBleRelayLeaseMock,
}));

vi.mock("./attendance", () => ({
  deriveAttendancePhase: deriveAttendancePhaseMock,
}));

vi.mock("./qr", () => ({
  verifyQrTokenStrict: verifyQrTokenStrictMock,
}));

const {
  recordRelayAttendance,
  registerRelayDevice,
  startRelayBroadcast,
} = await import("./ble-relay");

describe("ble-relay lease gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    bleRelayDeviceFindUniqueMock.mockResolvedValue({
      id: "relay-1",
      sessionId: "session-1",
      status: "APPROVED",
      bleBeaconUuid: "uuid-1",
      broadcastPower: -5,
      studentId: "student-1",
    });
    attendanceSessionFindUniqueMock.mockResolvedValue({
      courseId: "course-1",
      status: "ACTIVE",
      phase: "PHASE_ONE",
      endsAt: new Date("2026-03-17T10:10:00.000Z"),
      relayEnabled: true,
      qrSecret: "secret",
      qrRotationMs: 5000,
      qrGraceMs: 1000,
      course: { code: "CSC101" },
    });
    relayAttendanceRecordFindUniqueMock.mockResolvedValue(null);
    attendanceRecordFindFirstMock.mockResolvedValue({
      id: "attendance-1",
      faceVerified: true,
    });
    relayAttendanceRecordCreateMock.mockResolvedValue({ id: "record-1" });
    bleRelayDeviceUpdateMock.mockResolvedValue({ id: "relay-1" });
    getFreshBleRelayLeaseMock.mockResolvedValue(null);
    verifyQrTokenStrictMock.mockReturnValue(true);
    deriveAttendancePhaseMock.mockReturnValue("PHASE_ONE");
  });

  it("refuses to start relay broadcast when the lecturer lease is stale", async () => {
    const result = await startRelayBroadcast(
      "relay-1",
      "token-1",
      "session-1",
      "student-1"
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/heartbeat is required/i);
    expect(verifyQrTokenStrictMock).not.toHaveBeenCalled();
  });

  it("refuses to record relay attendance when the lecturer lease is stale", async () => {
    const result = await recordRelayAttendance("attendance-1", "relay-1", -65, 3);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/heartbeat is required/i);
    expect(relayAttendanceRecordCreateMock).not.toHaveBeenCalled();
  });

  it("refuses relay registration before the student has a verified attendance record", async () => {
    attendanceRecordFindFirstMock.mockResolvedValueOnce(null);
    bleRelayDeviceFindUniqueMock.mockResolvedValueOnce(null);

    const result = await registerRelayDevice("session-1", "student-1", "device-1");

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/mark attendance successfully/i);
  });
});
