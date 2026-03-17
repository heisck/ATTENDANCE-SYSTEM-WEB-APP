import { createHash } from "node:crypto";
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
import { calculateConfidence, isFlagged } from "@/lib/confidence";
import {
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

const ATTENDANCE_SESSION_META_TTL_SECONDS = 5 * 60;

type CachedAttendanceSessionMeta = {
  id: string;
  courseId: string;
  lecturerId: string;
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
) {
  const userAgent = request.headers.get("user-agent") ?? "";
  const rawDeviceToken =
    typeof body.deviceToken === "string" ? body.deviceToken.trim() : "";
  const fallbackTokenSource = `${studentId}:${userAgent || "unknown-user-agent"}`;
  const fallbackDeviceToken = `web-${createHash("sha256")
    .update(fallbackTokenSource)
    .digest("hex")
    .slice(0, 40)}`;

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

  return {
    rawDeviceToken,
    deviceToken: rawDeviceToken || fallbackDeviceToken,
    deviceName: resolvedDeviceName,
    deviceType: resolvedDeviceType,
    osVersion: typeof body.osVersion === "string" ? body.osVersion : undefined,
    appVersion: typeof body.appVersion === "string" ? body.appVersion : undefined,
    fingerprint:
      typeof body.deviceFingerprint === "string"
        ? body.deviceFingerprint
        : undefined,
    bleSignature:
      typeof body.bleSignature === "string" ? body.bleSignature : undefined,
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
  }>(cacheKey);

  if (!studentState) {
    const result = await db.user.findUnique({
      where: { id: input.studentId },
      select: {
        personalEmail: true,
        personalEmailVerifiedAt: true,
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

  if (syncedSession.phase === "PHASE_TWO") {
    const phaseCompletionGate = await getStudentPhaseCompletionForCourseDay({
      studentId: input.studentId,
      courseId: attendanceSession.courseId,
      lecturerId: attendanceSession.lecturerId,
      referenceTime: attendanceSession.startedAt,
    });

    if (!phaseCompletionGate.phaseOneDone) {
      throw new AttendanceRequestError(
        "Phase 1 attendance is required before you can mark Phase 2 for this class.",
        403
      );
    }
  }

  return {
    syncedSession,
    attendanceSession,
  } as PreparedAttendanceMarkContext;
}

export async function executeAttendanceMark(input: {
  request: NextRequest;
  studentId: string;
  context: PreparedAttendanceMarkContext;
  body: DevicePayload;
  recordQrToken: string;
  buildSecurity: (input: SecurityBuildInput) => SecurityBuildOutput;
}) {
  const deviceContext = resolveDeviceContext(input.request, input.studentId, input.body);

  const deviceLinkResult = await linkDevice(input.studentId, deviceContext.deviceToken, {
    deviceName: deviceContext.deviceName,
    deviceType: deviceContext.deviceType as "iOS" | "Android" | "Web",
    osVersion: deviceContext.osVersion,
    appVersion: deviceContext.appVersion,
    fingerprint: deviceContext.fingerprint,
    bleSignature: deviceContext.bleSignature,
  });

  const deviceConsistency = await getDeviceConsistencyScore(
    input.studentId,
    deviceContext.deviceToken
  );
  const deviceMismatch = deviceConsistency < 50 && !deviceLinkResult.trustedAt;

  const bleStats = deviceContext.rawDeviceToken
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

  let record;
  try {
    record = await db.attendanceRecord.create({
      data: {
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
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "P2002") {
      throw new AttendanceAlreadyMarkedError();
    }
    throw error;
  }

  let phaseCompletion: StudentPhaseCompletion | null = null;
  try {
    await invalidateStudentPhaseCompletionForCourseDay({
      studentId: input.studentId,
      courseId: input.context.attendanceSession.courseId,
      lecturerId: input.context.attendanceSession.lecturerId,
      referenceTime: input.context.attendanceSession.startedAt,
    });

    phaseCompletion = await getStudentPhaseCompletionForCourseDay({
      studentId: input.studentId,
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

  if (deviceMismatch && flagged) {
    try {
      await db.attendanceAnomaly.createMany({
        data: [
          {
            studentId: input.studentId,
            sessionId: input.context.attendanceSession.id,
            anomalyType: "DEVICE_MISMATCH",
            severity: 40,
            confidence: deviceConsistency / 100,
            details: {
              consistency: deviceConsistency,
              isNewDevice: deviceLinkResult.isNewDevice,
              ...(security.anomalyDetails ?? {}),
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
  ]);

  return {
    record,
    phaseCompletion,
    flagged,
    confidence,
    deviceMismatch,
    responseLayers: {
      webauthn: true,
      ...security.responseLayers,
      deviceConsistent: !deviceMismatch,
    },
  };
}

export { DeviceTokenConflictError };
