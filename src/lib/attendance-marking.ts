import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  CACHE_KEYS,
  CACHE_TTL,
  cacheDel,
  cacheGet,
  cacheSet,
  checkRateLimit,
} from "@/lib/cache";
import {
  getBoundedSessionTtlSeconds,
  syncAttendanceSessionState,
} from "@/lib/attendance";
import { requireAttendanceProof } from "@/lib/attendance-proof";
import {
  createBrowserFingerprintHash,
  hasValidBrowserDeviceProof,
} from "@/lib/browser-device-proof";
import { calculateConfidence, isFlagged } from "@/lib/confidence";
import {
  BrowserDeviceVerificationError,
  DeviceTokenConflictError,
  getDeviceConsistencyScore,
  linkDevice,
} from "@/lib/device-linking";
import { getDeviceBleStats } from "@/lib/ble-verification";
import {
  getStudentPhaseCompletionForCourseDay,
  invalidateStudentPhaseCompletionForCourseDay,
  type StudentPhaseCompletion,
} from "@/lib/phase-completion";
import { hasSuccessfulPhaseOneFaceVerificationForCourseDay } from "@/lib/face";

const ATTENDANCE_SESSION_META_TTL_SECONDS = 5 * 60;

type CachedAttendanceSessionMeta = {
  id: string;
  courseId: string;
  lecturerId: string;
  sessionFamilyId: string | null;
  qrSecret: string;
  startedAt: string;
  endsAt: string;
  course: {
    organization: {
      settings: unknown;
    };
  };
};

type AttendanceSessionMeta = {
  id: string;
  courseId: string;
  lecturerId: string;
  sessionFamilyId: string | null;
  qrSecret: string;
  startedAt: Date;
  endsAt: Date;
  course: {
    organization: {
      settings: unknown;
    };
  };
};

type DevicePayload = {
  deviceToken?: unknown;
  deviceName?: unknown;
  deviceType?: unknown;
  osVersion?: unknown;
  appVersion?: unknown;
  deviceFingerprint?: unknown;
  bleSignature?: unknown;
  bleSignalStrength?: unknown;
};

type SecurityBuildInput = {
  deviceConsistency: number;
  deviceMismatch: boolean;
  bleStats: Awaited<ReturnType<typeof getDeviceBleStats>>;
  deviceLinkResult: {
    id: string;
    isNewDevice: boolean;
    trustedAt: Date | null;
  };
};

type SecurityBuildOutput = {
  confidenceInput: {
    qrTokenValid?: boolean | null;
    bleProximityVerified?: boolean | null;
    bleSignalStrength?: number | null;
  };
  responseLayers: {
    qr: boolean | null;
    ble: boolean | null;
  };
  recordBleSignalStrength?: number | null;
  anomalyDetails?: Record<string, unknown>;
};

type ResolvedDeviceContext = {
  rawDeviceToken: string;
  deviceToken: string;
  deviceName: string;
  deviceType: "iOS" | "Android" | "Web";
  osVersion?: string;
  appVersion?: string;
  fingerprint?: string;
  bleSignature?: string;
  isBrowserClient: boolean;
  browserProofValid: boolean;
};

export class AttendanceRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AttendanceRequestError";
    this.status = status;
  }
}

export class AttendanceAlreadyMarkedError extends AttendanceRequestError {
  constructor() {
    super("You have already marked attendance for this session", 409);
    this.name = "AttendanceAlreadyMarkedError";
  }
}

export type PreparedAttendanceMarkContext = {
  syncedSession: NonNullable<Awaited<ReturnType<typeof syncAttendanceSessionState>>>;
  attendanceSession: AttendanceSessionMeta;
};

type AttendanceRecordDraft = {
  sessionId: string;
  studentId: string;
  qrToken: string;
  webauthnUsed: boolean;
  confidence: number;
  flagged: boolean;
  deviceToken: string | null;
  bleSignalStrength: number | null;
  deviceConsistency: number;
  anomalyScore: number;
};

export type BuiltAttendanceMark = {
  recordData: AttendanceRecordDraft;
  phaseCompletion: StudentPhaseCompletion | null;
  flagged: boolean;
  confidence: number;
  deviceMismatch: boolean;
  deviceConsistency: number;
  anomalyDetails?: Record<string, unknown>;
  responseLayers: {
    webauthn: boolean;
    qr: boolean | null;
    ble: boolean | null;
    deviceConsistent: boolean;
    face?: boolean | null;
  };
  browserDeviceBinding: {
    deviceToken: string;
    fingerprintHash: string;
  } | null;
  deviceLinkResult: {
    id: string;
    isNewDevice: boolean;
    trustedAt: Date | null;
  } | null;
};

export type PersistedAttendanceMark = BuiltAttendanceMark & {
  record: {
    id: string;
    confidence: number;
    flagged: boolean;
    faceVerified: boolean;
  };
};

function serializeAttendanceSessionMeta(
  session: AttendanceSessionMeta
): CachedAttendanceSessionMeta {
  return {
    ...session,
    startedAt: session.startedAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
  };
}

function deserializeAttendanceSessionMeta(
  session: CachedAttendanceSessionMeta
): AttendanceSessionMeta {
  return {
    ...session,
    startedAt: new Date(session.startedAt),
    endsAt: new Date(session.endsAt),
  };
}

async function getAttendanceSessionMeta(sessionId: string) {
  const cacheKey = `attendance:mark-session:${sessionId}`;
  const cached = await cacheGet<CachedAttendanceSessionMeta>(cacheKey);
  if (cached) {
    return deserializeAttendanceSessionMeta(cached);
  }

  const session = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      courseId: true,
      lecturerId: true,
      sessionFamilyId: true,
      qrSecret: true,
      startedAt: true,
      endsAt: true,
      course: {
        select: {
          organization: {
            select: {
              settings: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  await cacheSet(
    cacheKey,
    serializeAttendanceSessionMeta(session),
    getBoundedSessionTtlSeconds(
      session.endsAt,
      ATTENDANCE_SESSION_META_TTL_SECONDS
    )
  );

  return session;
}

function resolveDeviceContext(
  request: NextRequest,
  studentId: string,
  body: DevicePayload
): ResolvedDeviceContext {
  const userAgent = request.headers.get("user-agent") ?? "";
  const rawDeviceToken =
    typeof body.deviceToken === "string" ? body.deviceToken.trim().slice(0, 160) : "";

  const resolvedDeviceType: "iOS" | "Android" | "Web" =
    body.deviceType === "iOS" || body.deviceType === "Android" || body.deviceType === "Web"
      ? body.deviceType
      : /android/i.test(userAgent)
        ? "Android"
        : /(iphone|ipad|ipod)/i.test(userAgent)
          ? "iOS"
          : "Web";

  const resolvedDeviceName =
    typeof body.deviceName === "string" && body.deviceName.trim().length > 0
      ? body.deviceName.trim().slice(0, 120)
      : userAgent
        ? userAgent.slice(0, 120)
        : "Unknown Device";

  if (!rawDeviceToken) {
    throw new AttendanceRequestError(
      "Device verification is missing. Refresh the page and try again.",
      400
    );
  }

  const appVersion =
    typeof body.appVersion === "string" ? body.appVersion.trim().slice(0, 80) : undefined;
  const fingerprint = createBrowserFingerprintHash(
    request,
    typeof body.deviceFingerprint === "string" ? body.deviceFingerprint : undefined
  );

  if (!fingerprint) {
    throw new AttendanceRequestError(
      "Device verification failed on this browser. Verify your passkey again and try once more.",
      400
    );
  }

  const browserProofValid = hasValidBrowserDeviceProof(request, {
    userId: studentId,
    deviceToken: rawDeviceToken,
    fingerprintHash: fingerprint,
  });
  if (!browserProofValid) {
    throw new AttendanceRequestError(
      "Verify your passkey again on this device before marking attendance.",
      403
    );
  }

  return {
    rawDeviceToken,
    deviceToken: rawDeviceToken,
    deviceName: resolvedDeviceName,
    deviceType: resolvedDeviceType,
    osVersion: typeof body.osVersion === "string" ? body.osVersion : undefined,
    appVersion,
    fingerprint: fingerprint ?? undefined,
    bleSignature:
      typeof body.bleSignature === "string" ? body.bleSignature : undefined,
    isBrowserClient: true,
    browserProofValid: true,
  };
}

export async function prepareAttendanceMarkContext(input: {
  request: NextRequest;
  studentId: string;
  sessionId: string;
  maxAttempts?: number;
  windowSeconds?: number;
}) {
  requireAttendanceProof(input.request, input.studentId);

  const { allowed } = await checkRateLimit(
    input.studentId,
    input.sessionId,
    input.maxAttempts ?? 30,
    input.windowSeconds ?? 60
  );
  if (!allowed) {
    throw new AttendanceRequestError(
      "Too many submission attempts. Please wait before trying again.",
      429
    );
  }

  const cacheKey = CACHE_KEYS.USER_CREDENTIALS(input.studentId);
  let studentState = await cacheGet<{
    personalEmail: string | null;
    personalEmailVerifiedAt: string | Date | null;
    faceEnrollment?: {
      status: string;
      primaryImageUrl: string | null;
    } | null;
  }>(cacheKey);

  if (!studentState || !("faceEnrollment" in studentState)) {
    const result = await db.user.findUnique({
      where: { id: input.studentId },
      select: {
        personalEmail: true,
        personalEmailVerifiedAt: true,
        faceEnrollment: {
          select: {
            status: true,
            primaryImageUrl: true,
          },
        },
      },
    });
    studentState = result;
    if (studentState) {
      await cacheSet(cacheKey, studentState, CACHE_TTL.USER_CREDENTIALS);
    }
  }

  if (!studentState?.personalEmail || !studentState.personalEmailVerifiedAt) {
    throw new AttendanceRequestError(
      "Complete and verify your personal email before attendance.",
      403
    );
  }

  if (
    studentState.faceEnrollment?.status !== "COMPLETED" ||
    !studentState.faceEnrollment.primaryImageUrl
  ) {
    throw new AttendanceRequestError(
      "Complete face enrollment before attendance.",
      403
    );
  }

  const credentialCacheKey = `attendance:credential-count:${input.studentId}`;
  let credentialCount = await cacheGet<number>(credentialCacheKey);
  if (credentialCount == null) {
    credentialCount = await db.webAuthnCredential.count({
      where: { userId: input.studentId },
    });
    await cacheSet(credentialCacheKey, credentialCount, 600);
  }

  if (credentialCount === 0) {
    throw new AttendanceRequestError("Register a passkey before attendance.", 403);
  }

  const syncedSession = await syncAttendanceSessionState(input.sessionId);
  if (!syncedSession) {
    throw new AttendanceRequestError("Session not found", 404);
  }

  if (syncedSession.status !== "ACTIVE") {
    throw new AttendanceRequestError("Session is no longer active", 410);
  }

  const attendanceSession = await getAttendanceSessionMeta(input.sessionId);
  if (!attendanceSession) {
    throw new AttendanceRequestError("Session not found", 404);
  }

  const enrollmentCacheKey = `attendance:enrollment:${input.sessionId}:${input.studentId}`;
  let isEnrolled = await cacheGet<boolean>(enrollmentCacheKey);
  if (isEnrolled == null) {
    const enrollmentCount = await db.enrollment.count({
      where: {
        courseId: attendanceSession.courseId,
        studentId: input.studentId,
      },
    });
    isEnrolled = enrollmentCount > 0;
    await cacheSet(enrollmentCacheKey, isEnrolled, 300);
  }

  if (!isEnrolled) {
    throw new AttendanceRequestError("You are not enrolled in this course", 403);
  }

  const phaseCompletionGate = await getStudentPhaseCompletionForCourseDay({
    studentId: input.studentId,
    sessionFamilyId: attendanceSession.sessionFamilyId,
    courseId: attendanceSession.courseId,
    lecturerId: attendanceSession.lecturerId,
    referenceTime: attendanceSession.startedAt,
  });

  if (syncedSession.phase === "PHASE_ONE" && phaseCompletionGate.phaseOneDone) {
    throw new AttendanceRequestError(
      "You already completed Phase 1 for this class. Wait for Phase 2 or ask your lecturer for guidance.",
      409
    );
  }

  if (syncedSession.phase === "PHASE_TWO") {
    if (!phaseCompletionGate.phaseOneDone) {
      throw new AttendanceRequestError(
        "Phase 1 attendance is required before you can mark Phase 2 for this class.",
        403
      );
    }

    const hasSuccessfulPhaseOneFaceVerification =
      await hasSuccessfulPhaseOneFaceVerificationForCourseDay({
        userId: input.studentId,
        sessionFamilyId: attendanceSession.sessionFamilyId,
        courseId: attendanceSession.courseId,
        lecturerId: attendanceSession.lecturerId,
        referenceTime: attendanceSession.startedAt,
      });

    if (!hasSuccessfulPhaseOneFaceVerification) {
      throw new AttendanceRequestError(
        "Your Phase 1 face verification is required before you can mark Phase 2.",
        403
      );
    }

    if (phaseCompletionGate.phaseTwoDone) {
      throw new AttendanceRequestError(
        "You already completed Phase 2 for this class.",
        409
      );
    }
  }

  return {
    syncedSession,
    attendanceSession,
  } as PreparedAttendanceMarkContext;
}

export async function buildAttendanceMark(input: {
  request: NextRequest;
  studentId: string;
  context: PreparedAttendanceMarkContext;
  body: DevicePayload;
  recordQrToken: string;
  loadBleStats?: boolean;
  buildSecurity: (input: SecurityBuildInput) => SecurityBuildOutput;
}): Promise<BuiltAttendanceMark> {
  const deviceContext = resolveDeviceContext(input.request, input.studentId, input.body);

  const deviceLinkResult = await linkDevice(input.studentId, deviceContext.deviceToken, {
    deviceName: deviceContext.deviceName,
    deviceType: deviceContext.deviceType as "iOS" | "Android" | "Web",
    osVersion: deviceContext.osVersion,
    appVersion: deviceContext.appVersion,
    fingerprint: deviceContext.fingerprint,
    bleSignature: deviceContext.bleSignature,
    browserProofValid: deviceContext.browserProofValid,
  });

  const deviceConsistency = await getDeviceConsistencyScore(
    input.studentId,
    deviceContext.deviceToken
  );
  const deviceMismatch = deviceConsistency < 50 && !deviceLinkResult.trustedAt;

  const bleStats = input.loadBleStats
    ? await getDeviceBleStats(deviceLinkResult.id)
    : {
        averageRssi: null,
        verificationCount: 0,
        lastVerified: null,
        distanceMeters: 0,
      };

  const security = input.buildSecurity({
    deviceConsistency,
    deviceMismatch,
    bleStats,
    deviceLinkResult,
  });

  const confidence = calculateConfidence({
    webauthnVerified: true,
    ...security.confidenceInput,
    deviceConsistency,
    deviceMismatch,
  });

  const settings =
    (input.context.attendanceSession.course.organization.settings as Record<
      string,
      unknown
    > | null) ?? null;
  const threshold =
    typeof settings?.confidenceThreshold === "number"
      ? settings.confidenceThreshold
      : 70;
  const flagged = isFlagged(confidence, threshold, deviceMismatch);
  return {
    recordData: {
      sessionId: input.context.attendanceSession.id,
      studentId: input.studentId,
      qrToken: input.recordQrToken,
      webauthnUsed: true,
      confidence,
      flagged,
      deviceToken: deviceContext.deviceToken,
      bleSignalStrength: security.recordBleSignalStrength ?? null,
      deviceConsistency,
      anomalyScore: deviceMismatch ? Math.max(0, 100 - confidence) : 0,
    },
    phaseCompletion: null,
    flagged,
    confidence,
    deviceMismatch,
    deviceConsistency,
    anomalyDetails: security.anomalyDetails,
    deviceLinkResult,
    browserDeviceBinding:
      deviceContext.isBrowserClient && deviceContext.fingerprint
        ? {
            deviceToken: deviceContext.deviceToken,
            fingerprintHash: deviceContext.fingerprint,
          }
        : null,
    responseLayers: {
      webauthn: true,
      ...security.responseLayers,
      deviceConsistent: !deviceMismatch,
    },
  };
}

export async function persistAttendanceMark(input: {
  studentId: string;
  context: PreparedAttendanceMarkContext;
  built: BuiltAttendanceMark;
  faceVerified?: boolean;
  consumePendingVerificationId?: string | null;
}): Promise<PersistedAttendanceMark> {
  const faceVerified = input.faceVerified ?? false;

  let record:
    | {
        id: string;
        confidence: number;
        flagged: boolean;
        faceVerified: boolean;
      }
    | undefined;

  try {
    await db.$transaction(async (tx) => {
      record = await tx.attendanceRecord.create({
        data: {
          ...input.built.recordData,
          faceVerified,
        },
        select: {
          id: true,
          confidence: true,
          flagged: true,
          faceVerified: true,
        },
      });

      if (input.consumePendingVerificationId) {
        await tx.pendingAttendanceFaceVerification.update({
          where: { id: input.consumePendingVerificationId },
          data: {
            consumedAt: new Date(),
          },
        });
      }
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "P2002") {
      if (input.consumePendingVerificationId) {
        await db.pendingAttendanceFaceVerification.updateMany({
          where: {
            id: input.consumePendingVerificationId,
          },
          data: {
            consumedAt: new Date(),
          },
        });
      }
      throw new AttendanceAlreadyMarkedError();
    }
    throw error;
  }

  let phaseCompletion: StudentPhaseCompletion | null = null;
  try {
    await invalidateStudentPhaseCompletionForCourseDay({
      studentId: input.studentId,
      sessionFamilyId: input.context.attendanceSession.sessionFamilyId,
      courseId: input.context.attendanceSession.courseId,
      lecturerId: input.context.attendanceSession.lecturerId,
      referenceTime: input.context.attendanceSession.startedAt,
    });

    phaseCompletion = await getStudentPhaseCompletionForCourseDay({
      studentId: input.studentId,
      sessionFamilyId: input.context.attendanceSession.sessionFamilyId,
      courseId: input.context.attendanceSession.courseId,
      lecturerId: input.context.attendanceSession.lecturerId,
      referenceTime: input.context.attendanceSession.startedAt,
    });
  } catch (phaseError) {
    console.warn("[attendance-marking] phase completion lookup failed", {
      studentId: input.studentId,
      sessionId: input.context.attendanceSession.id,
      error: phaseError instanceof Error ? phaseError.message : String(phaseError),
    });
  }

  if (input.built.deviceMismatch && input.built.flagged) {
    try {
      await db.attendanceAnomaly.createMany({
        data: [
          {
            studentId: input.studentId,
            sessionId: input.context.attendanceSession.id,
            anomalyType: "DEVICE_MISMATCH",
            severity: 40,
            confidence: input.built.deviceConsistency / 100,
            details: {
              consistency: input.built.deviceConsistency,
              isNewDevice: input.built.deviceLinkResult?.isNewDevice ?? false,
              ...(input.built.anomalyDetails ?? {}),
            },
          } as never,
        ],
      });
    } catch (anomalyError) {
      console.warn("[attendance-marking] anomaly persistence skipped", {
        studentId: input.studentId,
        sessionId: input.context.attendanceSession.id,
        error:
          anomalyError instanceof Error
            ? anomalyError.message
            : String(anomalyError),
      });
    }
  }

  await Promise.all([
    cacheDel(`attendance:session-me:${input.context.attendanceSession.id}:${input.studentId}`),
    cacheDel(`attendance:sessions:list:STUDENT:${input.studentId}:ACTIVE`),
    cacheDel(`attendance:sessions:list:STUDENT:${input.studentId}:ALL`),
    cacheDel(`attendance:sessions:list:STUDENT:${input.studentId}:ACTIVE:20`),
    cacheDel(`attendance:sessions:list:STUDENT:${input.studentId}:ALL:20`),
    cacheDel(`attendance:sessions:list:STUDENT:${input.studentId}:ACTIVE:100`),
    cacheDel(`attendance:sessions:list:STUDENT:${input.studentId}:ALL:100`),
  ]);

  return {
    ...input.built,
    phaseCompletion,
    responseLayers: {
      ...input.built.responseLayers,
      face: faceVerified ? true : null,
    },
    record: record!,
  };
}

export async function executeAttendanceMark(input: {
  request: NextRequest;
  studentId: string;
  context: PreparedAttendanceMarkContext;
  body: DevicePayload;
  recordQrToken: string;
  loadBleStats?: boolean;
  buildSecurity: (input: SecurityBuildInput) => SecurityBuildOutput;
}) {
  const built = await buildAttendanceMark(input);

  return persistAttendanceMark({
    studentId: input.studentId,
    context: input.context,
    built,
    faceVerified: false,
  });
}

export { BrowserDeviceVerificationError, DeviceTokenConflictError };
