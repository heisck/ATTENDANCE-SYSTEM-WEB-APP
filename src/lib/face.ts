import { randomUUID } from "node:crypto";
import {
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  RekognitionClient,
} from "@aws-sdk/client-rekognition";
import {
  CognitoIdentityClient,
  GetCredentialsForIdentityCommand,
  GetIdCommand,
} from "@aws-sdk/client-cognito-identity";
import {
  FaceFlowPurpose,
  FaceVerificationStatus,
  Prisma,
  type AttendancePhase,
  type AttendanceVerificationSource,
} from "@prisma/client";
import { db } from "@/lib/db";
import { destroyCloudinaryAsset, uploadCloudinaryAsset } from "@/lib/cloudinary";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";
import { syncAttendanceSessionState } from "@/lib/attendance";
import { CACHE_KEYS, cacheDel } from "@/lib/cache";

const DEFAULT_FACE_FLOW_TOKEN_TTL_MS = 1000 * 60 * 30;
const DEFAULT_LIVENESS_THRESHOLD = 90;
const DEFAULT_SIMILARITY_THRESHOLD = 90;

export type FaceAwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: string | null;
};

export class FaceFlowError extends Error {
  status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "FaceFlowError";
    this.status = status;
  }
}

function mapFaceProviderError(error: unknown): FaceFlowError | null {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";

  switch (name) {
    case "AccessDeniedException":
    case "AuthFailure":
    case "NotAuthorizedException":
    case "UnrecognizedClientException":
      return new FaceFlowError(
        "Face verification is not configured correctly yet. Ask your administrator to check the AWS permissions.",
        503
      );
    case "InvalidIdentityPoolConfigurationException":
    case "InvalidParameterException":
    case "ResourceNotFoundException":
    case "ValidationException":
      return new FaceFlowError(
        "Face verification is not configured correctly yet. Ask your administrator to check the AWS region and Cognito identity pool.",
        503
      );
    case "NetworkingError":
    case "TimeoutError":
    case "TooManyRequestsException":
    case "ThrottlingException":
      return new FaceFlowError(
        "Face verification is temporarily unavailable. Please wait a moment and try again.",
        503
      );
    default:
      return null;
  }
}

function getFaceRegion() {
  const region =
    process.env.AWS_REKOGNITION_REGION ||
    process.env.AWS_REGION ||
    process.env.NEXT_PUBLIC_AWS_REGION;

  if (!region) {
    throw new FaceFlowError(
      "Face verification is not configured yet. Ask your administrator to set the AWS region.",
      503
    );
  }

  return region;
}

function getCognitoIdentityPoolId() {
  const identityPoolId =
    process.env.AWS_COGNITO_IDENTITY_POOL_ID ||
    process.env.NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID;

  if (!identityPoolId) {
    throw new FaceFlowError(
      "Face verification is not configured yet. Ask your administrator to set the Cognito Identity Pool ID.",
      503
    );
  }

  return identityPoolId;
}

function getFaceFlowTokenTtlMs() {
  const value = Number(process.env.FACE_FLOW_TOKEN_TTL_MINUTES);
  if (Number.isFinite(value) && value > 0) {
    return value * 60_000;
  }
  return DEFAULT_FACE_FLOW_TOKEN_TTL_MS;
}

export function getFaceLivenessThreshold() {
  const value = Number(process.env.FACE_LIVENESS_MIN_CONFIDENCE);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LIVENESS_THRESHOLD;
}

export function getFaceSimilarityThreshold() {
  const value = Number(process.env.FACE_MATCH_MIN_SIMILARITY);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SIMILARITY_THRESHOLD;
}

export function getFaceClientConfig() {
  return {
    region: getFaceRegion(),
    livenessThreshold: getFaceLivenessThreshold(),
    similarityThreshold: getFaceSimilarityThreshold(),
  };
}

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REKOGNITION_REGION || process.env.AWS_REGION,
});

const cognitoIdentityClient = new CognitoIdentityClient({
  region: process.env.AWS_REGION || process.env.AWS_REKOGNITION_REGION,
});

async function createTemporaryCredentials(): Promise<FaceAwsCredentials> {
  try {
    const identityPoolId = getCognitoIdentityPoolId();
    const getId = await cognitoIdentityClient.send(
      new GetIdCommand({
        IdentityPoolId: identityPoolId,
      })
    );

    if (!getId.IdentityId) {
      throw new FaceFlowError("Unable to create a temporary face verification identity.", 503);
    }

    const credentialsResponse = await cognitoIdentityClient.send(
      new GetCredentialsForIdentityCommand({
        IdentityId: getId.IdentityId,
      })
    );

    const credentials = credentialsResponse.Credentials;
    if (!credentials?.AccessKeyId || !credentials.SecretKey) {
      throw new FaceFlowError("Unable to create temporary face verification credentials.", 503);
    }

    return {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretKey,
      sessionToken: credentials.SessionToken,
      expiration: credentials.Expiration ? credentials.Expiration.toISOString() : null,
    };
  } catch (error) {
    if (error instanceof FaceFlowError) {
      throw error;
    }

    const mappedError = mapFaceProviderError(error);
    if (mappedError) {
      throw mappedError;
    }

    throw error;
  }
}

async function createRekognitionLivenessSession() {
  try {
    const result = await rekognitionClient.send(new CreateFaceLivenessSessionCommand({}));
    if (!result.SessionId) {
      throw new FaceFlowError("Unable to start the face liveness session.", 503);
    }

    return result.SessionId;
  } catch (error) {
    if (error instanceof FaceFlowError) {
      throw error;
    }

    const mappedError = mapFaceProviderError(error);
    if (mappedError) {
      throw mappedError;
    }

    throw error;
  }
}

function buildFaceUploadPublicId(userId: string) {
  return `students/${userId}/face-${Date.now()}-${randomUUID()}`;
}

function getReferenceImageBytes(referenceImage: { Bytes?: Uint8Array | Buffer } | undefined) {
  const bytes = referenceImage?.Bytes;
  if (!bytes) {
    throw new FaceFlowError(
      "Amazon Rekognition did not return a usable face reference image. Please retry the capture.",
      422
    );
  }

  return Buffer.from(bytes);
}

async function fetchRemoteImageBytes(imageUrl: string) {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new FaceFlowError("Unable to load the enrolled face reference image.", 502);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function getFaceLivenessResults(livenessSessionId: string) {
  const result = await rekognitionClient.send(
    new GetFaceLivenessSessionResultsCommand({
      SessionId: livenessSessionId,
    })
  );

  if (result.Status === "FAILED") {
    throw new FaceFlowError(
      "Face liveness failed. Keep your face well lit and centered, then try again.",
      422
    );
  }

  if (result.Status === "EXPIRED") {
    throw new FaceFlowError("The face liveness session expired. Start a new capture.", 410);
  }

  if (result.Status !== "SUCCEEDED") {
    throw new FaceFlowError("Face liveness is not ready yet. Please try again.", 409);
  }

  return result;
}

async function logFaceFailure(input: {
  userId: string;
  purpose: FaceFlowPurpose;
  sessionId?: string | null;
  pendingVerificationId?: string | null;
  livenessSessionId?: string | null;
  failureReason: string;
  livenessScore?: number | null;
}) {
  await db.faceVerificationLog.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      status: FaceVerificationStatus.FAILED,
      sessionId: input.sessionId ?? null,
      pendingVerificationId: input.pendingVerificationId ?? null,
      livenessSessionId: input.livenessSessionId ?? null,
      livenessScore: input.livenessScore ?? null,
      failureReason: input.failureReason,
    },
  });
}

export async function createPendingAttendanceFaceVerification(input: {
  userId: string;
  sessionId: string;
  sessionFamilyId: string | null;
  phase: AttendancePhase;
  source: AttendanceVerificationSource;
  qrToken: string;
  confidence: number;
  flagged: boolean;
  deviceToken: string | null;
  bleSignalStrength: number | null;
  deviceConsistency: number | null;
  anomalyScore: number | null;
  responseLayers: Prisma.InputJsonValue;
  anomalyDetails: Prisma.InputJsonValue;
  expiresAt: Date;
}) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          await tx.pendingAttendanceFaceVerification.findFirst({
            where: {
              userId: input.userId,
              sessionId: input.sessionId,
              consumedAt: null,
            },
            select: { id: true },
          });

          await tx.pendingAttendanceFaceVerification.updateMany({
            where: {
              userId: input.userId,
              sessionId: input.sessionId,
              consumedAt: null,
            },
            data: {
              consumedAt: new Date(),
            },
          });

          return tx.pendingAttendanceFaceVerification.create({
            data: input,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      if (code === "P2034" && attempt < 2) {
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function requireValidFaceFlowToken(rawToken: string, purpose: FaceFlowPurpose) {
  const normalizedToken = rawToken.trim();
  if (!normalizedToken) {
    throw new FaceFlowError("Face enrollment link is missing or invalid.", 400);
  }

  const token = await db.faceFlowToken.findUnique({
    where: {
      tokenHash: hashToken(normalizedToken),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          faceEnrollment: {
            select: {
              status: true,
              primaryImageUrl: true,
              primaryImagePublicId: true,
              lastLivenessSessionId: true,
            },
          },
        },
      },
    },
  });

  const now = new Date();
  if (
    !token ||
    token.purpose !== purpose ||
    token.usedAt ||
    token.expiresAt <= now ||
    !token.user
  ) {
    throw new FaceFlowError("This face enrollment link is invalid or has expired.", 410);
  }

  return token;
}

function getEnrollmentMetadata(result: Awaited<ReturnType<typeof getFaceLivenessResults>>) {
  return {
    referenceBoundingBox: result.ReferenceImage?.BoundingBox ?? null,
    auditImageCount: Array.isArray(result.AuditImages) ? result.AuditImages.length : 0,
  };
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function issueEnrollmentFaceFlowToken(userId: string) {
  const rawToken = createRawToken();
  const now = new Date();
  const expiresAt = createExpiryDate(getFaceFlowTokenTtlMs());

  await db.$transaction([
    db.faceFlowToken.updateMany({
      where: {
        userId,
        purpose: FaceFlowPurpose.ENROLLMENT,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        usedAt: now,
      },
    }),
    db.faceFlowToken.create({
      data: {
        userId,
        purpose: FaceFlowPurpose.ENROLLMENT,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    }),
  ]);

  return {
    token: rawToken,
    expiresAt,
  };
}

export async function describeEnrollmentToken(rawToken: string) {
  const token = await requireValidFaceFlowToken(rawToken, FaceFlowPurpose.ENROLLMENT);
  const completed =
    token.user.faceEnrollment?.status === "COMPLETED" &&
    typeof token.user.faceEnrollment.primaryImageUrl === "string" &&
    token.user.faceEnrollment.primaryImageUrl.length > 0;

  return {
    userId: token.user.id,
    studentName: token.user.name,
    expiresAt: token.expiresAt,
    hasCompletedEnrollment: completed,
    profileImageUrl: token.user.faceEnrollment?.primaryImageUrl ?? token.user.image ?? null,
  };
}

export async function createEnrollmentLivenessCapture(rawToken: string) {
  const token = await requireValidFaceFlowToken(rawToken, FaceFlowPurpose.ENROLLMENT);
  const [sessionId, credentials] = await Promise.all([
    createRekognitionLivenessSession(),
    createTemporaryCredentials(),
  ]);

  await db.faceEnrollment.upsert({
    where: { userId: token.userId },
    create: {
      userId: token.userId,
      status: "PENDING",
      lastLivenessSessionId: sessionId,
    },
    update: {
      lastLivenessSessionId: sessionId,
    },
  });

  return {
    userId: token.userId,
    sessionId,
    region: getFaceRegion(),
    credentials,
  };
}

export async function finalizeEnrollmentLivenessCapture(input: {
  rawToken: string;
  livenessSessionId: string;
  enforcedUserId?: string; // SECURITY: If provided, token must belong to this user
}) {
  const token = await requireValidFaceFlowToken(input.rawToken, FaceFlowPurpose.ENROLLMENT);

  // SECURITY: Prevent biometric outsourcing - enforce token belongs to authenticated user
  if (input.enforcedUserId && token.user.id !== input.enforcedUserId) {
    throw new FaceFlowError(
      "This enrollment link does not belong to your account. You cannot enroll a face for another user.",
      403
    );
  }

  const faceEnrollment = token.user.faceEnrollment;

  if (
    faceEnrollment?.lastLivenessSessionId &&
    faceEnrollment.lastLivenessSessionId !== input.livenessSessionId
  ) {
    throw new FaceFlowError(
      "This face enrollment capture is no longer the active one. Start a fresh capture and try again.",
      409
    );
  }

    let previousPublicId = faceEnrollment?.primaryImagePublicId ?? null;
    try {
      const result = await getFaceLivenessResults(input.livenessSessionId);
      const livenessScore = result.Confidence ?? 0;
      const qualityMetadata = toJsonValue(getEnrollmentMetadata(result));
      if (livenessScore < getFaceLivenessThreshold()) {
        throw new FaceFlowError(
          `Face liveness confidence was too low (${Math.round(livenessScore)}%). Please retry in better lighting.`,
          422
      );
    }

    const referenceImageBytes = getReferenceImageBytes(result.ReferenceImage);
    const uploaded = await uploadCloudinaryAsset({
      buffer: referenceImageBytes,
      publicId: buildFaceUploadPublicId(token.userId),
      resourceType: "image",
      fileName: `${token.userId}-enrollment.jpg`,
      contentType: "image/jpeg",
      folder: "attendanceiq/faces",
    });

    await db.$transaction(async (tx) => {
      const existing = await tx.faceEnrollment.findUnique({
        where: { userId: token.userId },
        select: {
          primaryImagePublicId: true,
        },
      });
      previousPublicId = existing?.primaryImagePublicId ?? previousPublicId;

      await tx.faceEnrollment.upsert({
        where: { userId: token.userId },
        create: {
          userId: token.userId,
          status: "COMPLETED",
          primaryImageUrl: uploaded.secureUrl,
          primaryImagePublicId: uploaded.publicId,
          livenessScore,
          qualityMetadata,
          lastLivenessSessionId: input.livenessSessionId,
          enrolledAt: new Date(),
        },
        update: {
          status: "COMPLETED",
          primaryImageUrl: uploaded.secureUrl,
          primaryImagePublicId: uploaded.publicId,
          livenessScore,
          qualityMetadata,
          lastLivenessSessionId: input.livenessSessionId,
          enrolledAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: token.userId },
        data: {
          image: uploaded.secureUrl,
        },
      });

      await tx.faceFlowToken.update({
        where: { id: token.id },
        data: {
          usedAt: new Date(),
        },
      });

      await tx.faceVerificationLog.create({
        data: {
          userId: token.userId,
          purpose: FaceFlowPurpose.ENROLLMENT,
          status: FaceVerificationStatus.SUCCEEDED,
          livenessSessionId: input.livenessSessionId,
          livenessScore,
          referenceImageUrl: uploaded.secureUrl,
          metadata: qualityMetadata,
        },
      });
    });

    if (previousPublicId && previousPublicId !== uploaded.publicId) {
      await destroyCloudinaryAsset({
        publicId: previousPublicId,
        resourceType: "image",
      }).catch(() => false);
    }

    await cacheDel(CACHE_KEYS.USER_CREDENTIALS(token.userId)).catch(() => undefined);

    return {
      userId: token.userId,
      profileImageUrl: uploaded.secureUrl,
    };
  } catch (error) {
    const message =
      error instanceof FaceFlowError ? error.message : "Face enrollment could not be completed.";

    await db.faceEnrollment
      .upsert({
        where: { userId: token.userId },
        create: {
          userId: token.userId,
          status: "FAILED",
          lastLivenessSessionId: input.livenessSessionId,
        },
        update: {
          status:
            faceEnrollment?.status === "COMPLETED" ? faceEnrollment.status : "FAILED",
          lastLivenessSessionId: input.livenessSessionId,
        },
      })
      .catch(() => undefined);

    await logFaceFailure({
      userId: token.userId,
      purpose: FaceFlowPurpose.ENROLLMENT,
      livenessSessionId: input.livenessSessionId,
      failureReason: message,
    }).catch(() => undefined);

    throw error;
  }
}

export async function createAttendanceFaceVerificationCapture(input: {
  userId: string;
  pendingVerificationId: string;
}) {
  const pending = await db.pendingAttendanceFaceVerification.findFirst({
    where: {
      id: input.pendingVerificationId,
      userId: input.userId,
      consumedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      sessionId: true,
      phase: true,
    },
  });

  if (!pending) {
    throw new FaceFlowError("This attendance face verification request is no longer valid.", 410);
  }

  const syncedSession = await syncAttendanceSessionState(pending.sessionId);
  if (!syncedSession || syncedSession.status !== "ACTIVE" || syncedSession.phase !== "PHASE_ONE") {
    throw new FaceFlowError("Phase 1 is no longer active for this class.", 410);
  }

  const [sessionId, credentials] = await Promise.all([
    createRekognitionLivenessSession(),
    createTemporaryCredentials(),
  ]);

  await db.pendingAttendanceFaceVerification.update({
    where: { id: pending.id },
    data: {
      livenessSessionId: sessionId,
    },
  });

  return {
    sessionId,
    region: getFaceRegion(),
    credentials,
  };
}

export async function performAttendanceFaceVerification(input: {
  userId: string;
  pendingVerificationId: string;
  livenessSessionId: string;
}) {
  const pending = await db.pendingAttendanceFaceVerification.findFirst({
    where: {
      id: input.pendingVerificationId,
      userId: input.userId,
      consumedAt: null,
    },
    include: {
      session: {
        select: {
          id: true,
          courseId: true,
          lecturerId: true,
          sessionFamilyId: true,
          startedAt: true,
          phase: true,
          status: true,
        },
      },
    },
  });

  if (!pending) {
    throw new FaceFlowError("This attendance face verification request is no longer valid.", 410);
  }

  if (pending.expiresAt <= new Date()) {
    throw new FaceFlowError("This attendance face verification request has expired.", 410);
  }

  if (pending.livenessSessionId !== input.livenessSessionId) {
    throw new FaceFlowError("Start a new face verification capture before submitting again.", 409);
  }

  const syncedSession = await syncAttendanceSessionState(pending.sessionId);
  if (!syncedSession || syncedSession.status !== "ACTIVE" || syncedSession.phase !== "PHASE_ONE") {
    throw new FaceFlowError("Phase 1 is no longer active for this class.", 410);
  }

  const enrollment = await db.faceEnrollment.findUnique({
    where: { userId: input.userId },
    select: {
      primaryImageUrl: true,
      status: true,
    },
  });

  if (
    enrollment?.status !== "COMPLETED" ||
    !enrollment.primaryImageUrl
  ) {
    throw new FaceFlowError("Complete face enrollment before attendance verification.", 403);
  }

  const results = await getFaceLivenessResults(input.livenessSessionId);
  const livenessScore = results.Confidence ?? 0;
  if (livenessScore < getFaceLivenessThreshold()) {
    await logFaceFailure({
      userId: input.userId,
      purpose: FaceFlowPurpose.ATTENDANCE_PHASE_ONE,
      sessionId: pending.sessionId,
      pendingVerificationId: pending.id,
      livenessSessionId: input.livenessSessionId,
      livenessScore,
      failureReason: `Face liveness confidence was too low (${Math.round(livenessScore)}%).`,
    });
    throw new FaceFlowError(
      `Face liveness confidence was too low (${Math.round(livenessScore)}%). Please retry.`,
      422
    );
  }

  const liveSourceImage = getReferenceImageBytes(results.ReferenceImage);
  const referenceImageBytes = await fetchRemoteImageBytes(enrollment.primaryImageUrl);
  const compareResult = await rekognitionClient.send(
    new CompareFacesCommand({
      SourceImage: {
        Bytes: liveSourceImage,
      },
      TargetImage: {
        Bytes: referenceImageBytes,
      },
      QualityFilter: "AUTO",
      SimilarityThreshold: getFaceSimilarityThreshold(),
    })
  );

  const bestMatch = (compareResult.FaceMatches || []).reduce<number | null>((best, match) => {
    const similarity = typeof match.Similarity === "number" ? match.Similarity : null;
    if (similarity == null) return best;
    return best == null || similarity > best ? similarity : best;
  }, null);

  if (bestMatch == null || bestMatch < getFaceSimilarityThreshold()) {
    await logFaceFailure({
      userId: input.userId,
      purpose: FaceFlowPurpose.ATTENDANCE_PHASE_ONE,
      sessionId: pending.sessionId,
      pendingVerificationId: pending.id,
      livenessSessionId: input.livenessSessionId,
      livenessScore,
      failureReason: "Live face did not match the enrolled face reference.",
    });
    throw new FaceFlowError(
      "Live face verification did not match your enrolled face. Try again yourself in better lighting.",
      403
    );
  }

  await db.faceVerificationLog.create({
    data: {
      userId: input.userId,
      sessionId: pending.sessionId,
      pendingVerificationId: pending.id,
      purpose: FaceFlowPurpose.ATTENDANCE_PHASE_ONE,
      status: FaceVerificationStatus.SUCCEEDED,
      livenessSessionId: input.livenessSessionId,
      livenessScore,
      faceSimilarity: bestMatch,
      referenceImageUrl: enrollment.primaryImageUrl,
      metadata: toJsonValue({
        sessionFamilyId: pending.sessionFamilyId,
      }),
    },
  });

  return {
    pending,
    livenessScore,
    faceSimilarity: bestMatch,
    referenceImageUrl: enrollment.primaryImageUrl,
  };
}

function getUtcDayRange(reference: Date) {
  const start = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function hasSuccessfulPhaseOneFaceVerificationForCourseDay(input: {
  userId: string;
  sessionFamilyId?: string | null;
  courseId: string;
  lecturerId?: string | null;
  referenceTime: Date;
}) {
  const where =
    typeof input.sessionFamilyId === "string" && input.sessionFamilyId.trim().length > 0
      ? {
          userId: input.userId,
          purpose: FaceFlowPurpose.ATTENDANCE_PHASE_ONE,
          status: FaceVerificationStatus.SUCCEEDED,
          session: {
            sessionFamilyId: input.sessionFamilyId.trim(),
          },
        }
      : {
          userId: input.userId,
          purpose: FaceFlowPurpose.ATTENDANCE_PHASE_ONE,
          status: FaceVerificationStatus.SUCCEEDED,
          session: {
            courseId: input.courseId,
            ...(input.lecturerId ? { lecturerId: input.lecturerId } : {}),
            startedAt: {
              gte: getUtcDayRange(input.referenceTime).start,
              lt: getUtcDayRange(input.referenceTime).end,
            },
          },
        };

  const match = await db.faceVerificationLog.findFirst({
    where,
    select: { id: true },
  });

  return Boolean(match);
}
