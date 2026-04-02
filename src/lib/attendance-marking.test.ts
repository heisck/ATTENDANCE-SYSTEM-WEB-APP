import { beforeEach, describe, expect, it, vi } from "vitest";

const attendanceRecordCreateMock = vi.fn();
const attendanceAnomalyCreateManyMock = vi.fn();
const transactionMock = vi.fn();
const cacheDelMock = vi.fn();
const linkDeviceMock = vi.fn();
const getDeviceConsistencyScoreMock = vi.fn();
const getDeviceBleStatsMock = vi.fn();
const calculateConfidenceMock = vi.fn();
const isFlaggedMock = vi.fn();
const invalidateStudentPhaseCompletionForCourseDayMock = vi.fn();
const getStudentPhaseCompletionForCourseDayMock = vi.fn();
const buildStudentPhaseCompletionStatusMock = vi.fn();
const setStudentPhaseCompletionForCourseDayMock = vi.fn();
const createBrowserFingerprintHashMock = vi.fn();
const hasValidBrowserDeviceProofMock = vi.fn();
const cacheDelBatchMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: transactionMock,
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
  cacheDelBatch: cacheDelBatchMock,
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

vi.mock("@/lib/browser-device-proof", () => ({
  createBrowserFingerprintHash: createBrowserFingerprintHashMock,
  hasValidBrowserDeviceProof: hasValidBrowserDeviceProofMock,
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
  buildStudentPhaseCompletionStatus: buildStudentPhaseCompletionStatusMock,
  setStudentPhaseCompletionForCourseDay: setStudentPhaseCompletionForCourseDayMock,
}));

vi.mock("@/lib/face", () => ({
  hasSuccessfulPhaseOneFaceVerificationForCourseDay: vi.fn().mockResolvedValue(true),
}));

const { AttendanceAlreadyMarkedError, executeAttendanceMark } = await import(
  "@/lib/attendance-marking"
);

describe("executeAttendanceMark", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    attendanceRecordCreateMock.mockResolvedValue({ id: "record-1" });
    attendanceAnomalyCreateManyMock.mockResolvedValue({ count: 1 });
    transactionMock.mockImplementation(async (callback: any) =>
      callback({
        attendanceRecord: {
          create: attendanceRecordCreateMock,
        },
        pendingAttendanceFaceVerification: {
          update: vi.fn(),
        },
      })
    );
    cacheDelMock.mockResolvedValue(true);
    cacheDelBatchMock.mockResolvedValue(true);
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
    setStudentPhaseCompletionForCourseDayMock.mockResolvedValue(undefined);
    getStudentPhaseCompletionForCourseDayMock.mockResolvedValue({
      phaseOneDone: true,
      phaseTwoDone: false,
      overallPresent: false,
      pendingPhase: "PHASE_TWO",
    });
    buildStudentPhaseCompletionStatusMock.mockReturnValue({
      phaseOneDone: true,
      phaseTwoDone: true,
      overallPresent: true,
      pendingPhase: null,
    });
    createBrowserFingerprintHashMock.mockImplementation(() => "browser-fingerprint-hash");
    hasValidBrowserDeviceProofMock.mockImplementation(() => true);
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
          sessionFamilyId: null,
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
        phaseCompletionGate: {
          phaseOneDone: true,
          phaseTwoDone: false,
          overallPresent: false,
          pendingPhase: "PHASE_TWO",
        },
      },
      body: {
        deviceToken: "device-token-1",
        deviceName: "Test Device",
        deviceType: "Web",
        deviceFingerprint: JSON.stringify({
          platform: "Win32",
          language: "en-US",
          languages: ["en-US", "en"],
          timezone: "Africa/Accra",
          screen: "1920x1080x24",
          hardwareConcurrency: 8,
          deviceMemory: 8,
          touchPoints: 0,
          vendor: "Google Inc.",
          cookieEnabled: true,
          colorScheme: "light",
        }),
        appVersion: "web",
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

    const deletedKeys = cacheDelBatchMock.mock.calls.flatMap(([keys]) => keys);

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
    expect(setStudentPhaseCompletionForCourseDayMock).toHaveBeenCalledWith(
      {
        studentId: "student-1",
        sessionFamilyId: null,
        courseId: "course-1",
        lecturerId: "lecturer-1",
        referenceTime: new Date("2026-03-17T10:00:00.000Z"),
      },
      expect.anything()
    );
  });

  it("returns browser device binding details for browser-based attendance", async () => {
    const result = await executeAttendanceMark({
      ...buildInput(),
      body: {
        deviceToken: "device-token-1",
        deviceName: "Test Device",
        deviceType: "Web",
        deviceFingerprint: JSON.stringify({
          platform: "Win32",
          language: "en-US",
          languages: ["en-US", "en"],
          timezone: "Africa/Accra",
          screen: "1920x1080x24",
          hardwareConcurrency: 8,
          deviceMemory: 8,
          touchPoints: 0,
          vendor: "Google Inc.",
          cookieEnabled: true,
          colorScheme: "light",
        }),
        appVersion: "web",
      },
    });

    expect(createBrowserFingerprintHashMock).toHaveBeenCalled();
    expect(result.browserDeviceBinding).toEqual({
      deviceToken: "device-token-1",
      fingerprintHash: "browser-fingerprint-hash",
    });
    expect(linkDeviceMock).toHaveBeenCalledWith(
      "student-1",
      "device-token-1",
      expect.objectContaining({
        fingerprint: "browser-fingerprint-hash",
        browserProofValid: true,
      })
    );
  });

  it("rejects attendance when the browser device proof cookie is missing or stale", async () => {
    hasValidBrowserDeviceProofMock.mockImplementation(() => false);

    await expect(executeAttendanceMark(buildInput())).rejects.toMatchObject({
      message: "Verify your passkey again on this device before marking attendance.",
      status: 403,
    });
  });
});
