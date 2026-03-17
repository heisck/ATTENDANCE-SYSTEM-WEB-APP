import { beforeEach, describe, expect, it, vi } from "vitest";

const attendanceRecordCreateMock = vi.fn();
const attendanceAnomalyCreateManyMock = vi.fn();
const cacheDelMock = vi.fn();
const linkDeviceMock = vi.fn();
const getDeviceConsistencyScoreMock = vi.fn();
const getDeviceBleStatsMock = vi.fn();
const calculateConfidenceMock = vi.fn();
const isFlaggedMock = vi.fn();
const invalidateStudentPhaseCompletionForCourseDayMock = vi.fn();
const getStudentPhaseCompletionForCourseDayMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    attendanceRecord: {
      create: attendanceRecordCreateMock,
    },
    attendanceAnomaly: {
      createMany: attendanceAnomalyCreateManyMock,
    },
  },
}));

vi.mock("@/lib/cache", () => ({
  CACHE_KEYS: {
    USER_CREDENTIALS: (userId: string) => `credentials:${userId}`,
  },
  CACHE_TTL: {
    USER_CREDENTIALS: 1800,
  },
  cacheDel: cacheDelMock,
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/attendance", () => ({
  getBoundedSessionTtlSeconds: vi.fn(() => 300),
  syncAttendanceSessionState: vi.fn(),
}));

vi.mock("@/lib/attendance-proof", () => ({
  requireAttendanceProof: vi.fn(),
}));

vi.mock("@/lib/device-linking", () => ({
  DeviceTokenConflictError: class DeviceTokenConflictError extends Error {},
  getDeviceConsistencyScore: getDeviceConsistencyScoreMock,
  linkDevice: linkDeviceMock,
}));

vi.mock("@/lib/ble-verification", () => ({
  getDeviceBleStats: getDeviceBleStatsMock,
}));

vi.mock("@/lib/confidence", () => ({
  calculateConfidence: calculateConfidenceMock,
  isFlagged: isFlaggedMock,
}));

vi.mock("@/lib/phase-completion", () => ({
  getStudentPhaseCompletionForCourseDay: getStudentPhaseCompletionForCourseDayMock,
  invalidateStudentPhaseCompletionForCourseDay:
    invalidateStudentPhaseCompletionForCourseDayMock,
}));

const { AttendanceAlreadyMarkedError, executeAttendanceMark } = await import(
  "@/lib/attendance-marking"
);

describe("executeAttendanceMark", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    attendanceRecordCreateMock.mockResolvedValue({ id: "record-1" });
    attendanceAnomalyCreateManyMock.mockResolvedValue({ count: 1 });
    cacheDelMock.mockResolvedValue(true);
    linkDeviceMock.mockResolvedValue({
      id: "device-1",
      isNewDevice: false,
      trustedAt: new Date("2026-03-17T10:00:00.000Z"),
    });
    getDeviceConsistencyScoreMock.mockResolvedValue(100);
    getDeviceBleStatsMock.mockResolvedValue({
      averageRssi: null,
      verificationCount: 0,
      lastVerified: null,
      distanceMeters: 0,
    });
    calculateConfidenceMock.mockReturnValue(95);
    isFlaggedMock.mockReturnValue(false);
    invalidateStudentPhaseCompletionForCourseDayMock.mockResolvedValue(undefined);
    getStudentPhaseCompletionForCourseDayMock.mockResolvedValue({
      phaseOneDone: true,
      phaseTwoDone: false,
      overallPresent: false,
      pendingPhase: "PHASE_TWO",
    });
  });

  function buildInput() {
    return {
      request: {
        headers: {
          get: (name: string) => (name === "user-agent" ? "Vitest Browser" : null),
        },
      } as any,
      studentId: "student-1",
      context: {
        syncedSession: {
          id: "session-1",
          status: "ACTIVE",
          phase: "PHASE_ONE",
          startedAt: new Date("2026-03-17T10:00:00.000Z"),
          endsAt: new Date("2026-03-17T10:04:00.000Z"),
          closedAt: null,
          relayEnabled: false,
          qrRotationMs: 5000,
          qrGraceMs: 1000,
        },
        attendanceSession: {
          id: "session-1",
          courseId: "course-1",
          lecturerId: "lecturer-1",
          qrSecret: "secret",
          startedAt: new Date("2026-03-17T10:00:00.000Z"),
          endsAt: new Date("2026-03-17T10:04:00.000Z"),
          course: {
            organization: {
              settings: {
                confidenceThreshold: 70,
              },
            },
          },
        },
      },
      body: {
        deviceToken: "device-token-1",
        deviceName: "Test Device",
        deviceType: "Web",
        deviceFingerprint: "fingerprint-1",
      },
      recordQrToken: "qr-token-1",
      buildSecurity: () => ({
        confidenceInput: {
          qrTokenValid: true,
          bleProximityVerified: false,
          bleSignalStrength: null,
        },
        responseLayers: {
          qr: true,
          ble: false,
        },
        recordBleSignalStrength: null,
      }),
    } as const;
  }

  it("maps duplicate inserts to AttendanceAlreadyMarkedError", async () => {
    attendanceRecordCreateMock.mockRejectedValueOnce({ code: "P2002" });

    await expect(executeAttendanceMark(buildInput())).rejects.toBeInstanceOf(
      AttendanceAlreadyMarkedError
    );
  });

  it("invalidates only the per-user attendance caches after a successful mark", async () => {
    await executeAttendanceMark(buildInput());

    const deletedKeys = cacheDelMock.mock.calls.map(([key]) => key);

    expect(deletedKeys).toEqual(
      expect.arrayContaining([
        "attendance:session-me:session-1:student-1",
        "attendance:sessions:list:STUDENT:student-1:ACTIVE",
        "attendance:sessions:list:STUDENT:student-1:ALL",
      ])
    );
    expect(deletedKeys).not.toContain("session:session-1");
    expect(deletedKeys).not.toContain("attendance:enrollment:session-1:student-1");
    expect(deletedKeys).not.toContain("student:live-sessions:student-1");
    expect(invalidateStudentPhaseCompletionForCourseDayMock).toHaveBeenCalledWith({
      studentId: "student-1",
      courseId: "course-1",
      lecturerId: "lecturer-1",
      referenceTime: new Date("2026-03-17T10:00:00.000Z"),
    });
  });
});
