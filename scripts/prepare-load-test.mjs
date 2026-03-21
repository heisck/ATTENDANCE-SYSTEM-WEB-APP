import nextEnv from "@next/env";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { encode as encodeAuthToken } from "next-auth/jwt";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

const USER_COUNT = Math.max(
  1,
  Number(process.env.LOAD_TEST_USER_COUNT || process.argv[2] || 5000)
);
const PHASE = (process.env.LOAD_TEST_PHASE || "PHASE_TWO").toUpperCase();
const COURSE_CODE = (process.env.LOAD_TEST_COURSE_CODE || "LOAD5000").toUpperCase();
const COURSE_NAME =
  process.env.LOAD_TEST_COURSE_NAME || "Attendance Load Test Performance Session";
const ORG_SLUG = process.env.LOAD_TEST_ORG_SLUG || "knust";
const PASSWORD = process.env.LOAD_TEST_PASSWORD || "password123";
const SESSION_DURATION_MINUTES = Math.max(
  5,
  Number(process.env.LOAD_TEST_SESSION_DURATION_MINUTES || 30)
);
const FIXTURES_DIR = path.join(process.cwd(), "load-tests", "fixtures");
const USERS_FILE = path.join(FIXTURES_DIR, "attendance-users.json");
const META_FILE = path.join(FIXTURES_DIR, "attendance-meta.json");
const COMMAND_FILE = path.join(FIXTURES_DIR, "attendance-loadtest-command.txt");
const LOAD_TEST_BASE_URL = process.env.LOAD_TEST_BASE_URL || "http://localhost:3000";
const STUDENT_EMAIL_PREFIX = "load.student";
const STUDENT_DOMAIN = "st.knust.edu.gh";
const STUDENT_PERSONAL_DOMAIN = "loadtest.local";
const LECTURER_EMAIL = process.env.LOAD_TEST_LECTURER_EMAIL || "load.lecturer@knust.edu.gh";
const USER_AGENT =
  process.env.LOAD_TEST_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const ACCEPT_LANGUAGE = process.env.LOAD_TEST_ACCEPT_LANGUAGE || "en-US,en;q=0.9";
const DEVICE_FINGERPRINT_PAYLOAD = JSON.stringify({
  platform: "Win32",
  language: "en-US",
  languages: ["en-US", "en"],
  timezone: "Africa/Accra",
  screen: "1920x1080",
  hardwareConcurrency: 8,
  deviceMemory: 8,
  touchPoints: 0,
  vendor: "Google Inc.",
  cookieEnabled: true,
  colorScheme: "light",
});
const ATTENDANCE_PROOF_COOKIE = "attendance_proof";
const BROWSER_DEVICE_PROOF_COOKIE = "attendance_browser_device";
const SESSION_COOKIE = "authjs.session-token";
const ATTENDANCE_PROOF_TTL_SECONDS = 10 * 60;
const BROWSER_DEVICE_PROOF_TTL_SECONDS = 90 * 24 * 60 * 60;
const AUTH_SALT = "authjs.session-token";
const ARGON2_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 4096,
  timeCost: 3,
  parallelism: 1,
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function fail(message) {
  throw new Error(message);
}

function ensurePhase(value) {
  if (value !== "PHASE_ONE" && value !== "PHASE_TWO") {
    fail(`Unsupported LOAD_TEST_PHASE value "${value}". Use PHASE_ONE or PHASE_TWO.`);
  }
  return value;
}

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    fail("AUTH_SECRET or NEXTAUTH_SECRET is required to generate load-test cookies.");
  }
  return secret;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sanitizeString(value, maxLength, fallback = "unknown") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, maxLength) : fallback;
}

function sanitizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => sanitizeString(item, maxLength, ""))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function sanitizeNullableNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function normalizeColorScheme(value) {
  if (value === "light" || value === "dark" || value === "no-preference") {
    return value;
  }

  return "unknown";
}

function createBrowserFingerprintHash(rawFingerprint) {
  const parsed = JSON.parse(rawFingerprint);
  const normalized = {
    version: 1,
    userAgent: sanitizeString(USER_AGENT, 240),
    acceptLanguage: sanitizeString(ACCEPT_LANGUAGE.split(",").slice(0, 2).join(","), 80),
    platform: sanitizeString(parsed.platform, 80),
    language: sanitizeString(parsed.language, 32),
    languages: sanitizeStringArray(parsed.languages, 5, 32),
    timezone: sanitizeString(parsed.timezone, 80),
    screen: sanitizeString(parsed.screen, 32),
    hardwareConcurrency: sanitizeNullableNumber(parsed.hardwareConcurrency),
    deviceMemory: sanitizeNullableNumber(parsed.deviceMemory),
    touchPoints: sanitizeNullableNumber(parsed.touchPoints),
    vendor: sanitizeString(parsed.vendor, 80),
    cookieEnabled: parsed.cookieEnabled === true,
    colorScheme: normalizeColorScheme(parsed.colorScheme),
  };

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("base64url");
}

function signProofPayload(encodedPayload) {
  return createHmac("sha256", getAuthSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function createAttendanceProofToken(userId, nowMs = Date.now()) {
  const payload = {
    userId,
    iat: nowMs,
    exp: nowMs + ATTENDANCE_PROOF_TTL_SECONDS * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signProofPayload(encodedPayload)}`;
}

function createBrowserDeviceProofToken(userId, deviceToken, fingerprintHash, nowMs = Date.now()) {
  const payload = {
    version: 1,
    userId,
    deviceToken,
    fingerprintHash,
    iat: nowMs,
    exp: nowMs + BROWSER_DEVICE_PROOF_TTL_SECONDS * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signProofPayload(encodedPayload)}`;
}

function buildStudentIdentity(index) {
  const serial = String(index + 1).padStart(6, "0");
  return {
    serial,
    email: `${STUDENT_EMAIL_PREFIX}${serial}@${STUDENT_DOMAIN}`,
    personalEmail: `${STUDENT_EMAIL_PREFIX}${serial}@${STUDENT_PERSONAL_DOMAIN}`,
    name: `Load Student ${serial}`,
    studentId: `LT${serial}`,
    indexNumber: `LOAD/${serial}`,
    deviceToken: `load-device-${serial}`,
    deviceName: `Load Test Browser ${serial}`,
    credentialId: `load-credential-${serial}`,
    livenessSessionId: `load-liveness-${serial}`,
  };
}

async function createSessionCookie(user) {
  return encodeAuthToken({
    secret: getAuthSecret(),
    salt: AUTH_SALT,
    maxAge: 30 * 24 * 60 * 60,
    token: {
      name: user.name,
      email: user.email,
      picture: user.image ?? null,
      sub: user.id,
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      image: user.image ?? null,
    },
  });
}

async function createUsers(passwordHash, organizationId) {
  const identities = Array.from({ length: USER_COUNT }, (_, index) =>
    buildStudentIdentity(index)
  );

  const existingUsers = await prisma.user.findMany({
    where: {
      email: {
        startsWith: STUDENT_EMAIL_PREFIX,
      },
    },
    select: { id: true },
  });

  if (existingUsers.length > 0) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: existingUsers.map((user) => user.id),
        },
      },
    });
  }

  for (const batch of chunkArray(identities, 500)) {
    await prisma.user.createMany({
      data: batch.map((identity) => ({
        email: identity.email,
        personalEmail: identity.personalEmail,
        name: identity.name,
        passwordHash,
        role: "STUDENT",
        studentId: identity.studentId,
        indexNumber: identity.indexNumber,
        organizationId,
        emailVerified: new Date(),
        personalEmailVerifiedAt: new Date(),
      })),
    });
  }

  const students = await prisma.user.findMany({
    where: {
      email: {
        startsWith: STUDENT_EMAIL_PREFIX,
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organizationId: true,
      image: true,
    },
    orderBy: { email: "asc" },
  });

  if (students.length !== USER_COUNT) {
    fail(`Expected ${USER_COUNT} load users, but found ${students.length}.`);
  }

  const studentsByEmail = new Map(students.map((student) => [student.email, student]));

  return identities.map((identity) => {
    const student = studentsByEmail.get(identity.email);
    if (!student) {
      fail(`Missing seeded user for ${identity.email}`);
    }

    return {
      ...identity,
      ...student,
    };
  });
}

async function ensureLecturerAndCourse(organizationId, passwordHash) {
  const lecturer = await prisma.user.upsert({
    where: { email: LECTURER_EMAIL },
    update: {
      name: "Load Test Lecturer",
      passwordHash,
      role: "LECTURER",
      organizationId,
      emailVerified: new Date(),
    },
    create: {
      email: LECTURER_EMAIL,
      name: "Load Test Lecturer",
      passwordHash,
      role: "LECTURER",
      organizationId,
      emailVerified: new Date(),
    },
    select: {
      id: true,
      email: true,
    },
  });

  const course = await prisma.course.upsert({
    where: {
      code_organizationId: {
        code: COURSE_CODE,
        organizationId,
      },
    },
    update: {
      name: COURSE_NAME,
      description: "Dedicated course for 5,000-user attendance load tests.",
      lecturerId: lecturer.id,
    },
    create: {
      code: COURSE_CODE,
      name: COURSE_NAME,
      description: "Dedicated course for 5,000-user attendance load tests.",
      organizationId,
      lecturerId: lecturer.id,
    },
    select: {
      id: true,
      code: true,
      name: true,
      lecturerId: true,
    },
  });

  return { lecturer, course };
}

async function prepareStudentArtifacts(students, courseId, fingerprintHash) {
  await prisma.attendanceSession.deleteMany({
    where: { courseId },
  });

  await prisma.enrollment.deleteMany({
    where: { courseId },
  });

  for (const batch of chunkArray(students, 500)) {
    await prisma.faceEnrollment.createMany({
      data: batch.map((student) => ({
        userId: student.id,
        status: "COMPLETED",
        primaryImageUrl: `https://loadtest.local/faces/${student.serial}.jpg`,
        primaryImagePublicId: `load-test/faces/${student.serial}`,
        livenessScore: 99,
        qualityMetadata: {
          source: "load-test",
        },
        enrolledAt: new Date(),
      })),
    });

    await prisma.webAuthnCredential.createMany({
      data: batch.map((student) => ({
        userId: student.id,
        credentialId: student.credentialId,
        publicKey: Buffer.from(`load-public-key-${student.serial}`),
        transports: ["internal"],
        deviceType: "singleDevice",
        backedUp: false,
        userAgent: USER_AGENT,
      })),
    });

    await prisma.userDevice.createMany({
      data: batch.map((student) => ({
        userId: student.id,
        deviceToken: student.deviceToken,
        deviceName: student.deviceName,
        deviceType: "Web",
        appVersion: "k6-load",
        fingerprint: fingerprintHash,
        lastUsedAt: new Date(),
        trustedAt: new Date(),
      })),
    });

    await prisma.enrollment.createMany({
      data: batch.map((student) => ({
        courseId,
        studentId: student.id,
      })),
    });
  }
}

async function createAttendanceSessions(course, students) {
  const now = new Date();
  const phase = ensurePhase(PHASE);
  const familyId = randomUUID();
  const activeSessionEndsAt = new Date(now.getTime() + SESSION_DURATION_MINUTES * 60 * 1000);

  if (phase === "PHASE_ONE") {
    const phaseOneSession = await prisma.attendanceSession.create({
      data: {
        courseId: course.id,
        lecturerId: course.lecturerId,
        status: "ACTIVE",
        phase: "PHASE_ONE",
        sessionFlow: "NEW_SESSION",
        sessionFamilyId: familyId,
        durationMinutes: SESSION_DURATION_MINUTES,
        startedAt: now,
        endsAt: activeSessionEndsAt,
        qrRotationMs: 5000,
        qrGraceMs: 1000,
        qrSecret: `load-qr-secret-${randomUUID()}`,
      },
      select: {
        id: true,
        phase: true,
        sessionFamilyId: true,
        qrSecret: true,
        startedAt: true,
        endsAt: true,
      },
    });

    return {
      session: phaseOneSession,
      prerequisiteSessionId: null,
    };
  }

  const phaseOneStartedAt = new Date(now.getTime() - 15 * 60 * 1000);
  const phaseOneEndedAt = new Date(now.getTime() - 10 * 60 * 1000);

  const phaseOneSession = await prisma.attendanceSession.create({
    data: {
      courseId: course.id,
      lecturerId: course.lecturerId,
      status: "CLOSED",
      phase: "CLOSED",
      sessionFlow: "NEW_SESSION",
      sessionFamilyId: familyId,
      durationMinutes: 5,
      startedAt: phaseOneStartedAt,
      endsAt: phaseOneEndedAt,
      closedAt: phaseOneEndedAt,
      qrRotationMs: 5000,
      qrGraceMs: 1000,
      qrSecret: `load-phase-one-secret-${randomUUID()}`,
    },
    select: {
      id: true,
    },
  });

  for (const batch of chunkArray(students, 500)) {
    await prisma.attendanceRecord.createMany({
      data: batch.map((student) => ({
        sessionId: phaseOneSession.id,
        studentId: student.id,
        qrToken: `phase-one-${student.serial}`,
        webauthnUsed: true,
        faceVerified: true,
        confidence: 100,
        flagged: false,
        deviceToken: student.deviceToken,
        deviceConsistency: 100,
        anomalyScore: 0,
        markedAt: new Date(phaseOneStartedAt.getTime() + 60_000),
      })),
    });

    await prisma.faceVerificationLog.createMany({
      data: batch.map((student) => ({
        userId: student.id,
        sessionId: phaseOneSession.id,
        purpose: "ATTENDANCE_PHASE_ONE",
        status: "SUCCEEDED",
        livenessSessionId: student.livenessSessionId,
        livenessScore: 99,
        faceSimilarity: 99,
        referenceImageUrl: `https://loadtest.local/faces/${student.serial}.jpg`,
        metadata: {
          source: "load-test",
          sessionFamilyId: familyId,
        },
      })),
    });
  }

  const phaseTwoSession = await prisma.attendanceSession.create({
    data: {
      courseId: course.id,
      lecturerId: course.lecturerId,
      status: "ACTIVE",
      phase: "PHASE_TWO",
      sessionFlow: "PHASE_TWO_CLOSING",
      sessionFamilyId: familyId,
      linkedSessionId: phaseOneSession.id,
      durationMinutes: SESSION_DURATION_MINUTES,
      startedAt: now,
      endsAt: activeSessionEndsAt,
      qrRotationMs: 5000,
      qrGraceMs: 1000,
      qrSecret: `load-phase-two-secret-${randomUUID()}`,
    },
    select: {
      id: true,
      phase: true,
      sessionFamilyId: true,
      qrSecret: true,
      startedAt: true,
      endsAt: true,
    },
  });

  return {
    session: phaseTwoSession,
    prerequisiteSessionId: phaseOneSession.id,
  };
}

async function buildUserFixtures(students, fingerprintHash) {
  const fixtures = [];

  for (const student of students) {
    const sessionToken = await createSessionCookie(student);
    const attendanceProof = createAttendanceProofToken(student.id);
    const browserProof = createBrowserDeviceProofToken(
      student.id,
      student.deviceToken,
      fingerprintHash
    );

    fixtures.push({
      userId: student.id,
      email: student.email,
      deviceToken: student.deviceToken,
      deviceName: student.deviceName,
      deviceType: "Web",
      appVersion: "k6-load",
      userAgent: USER_AGENT,
      acceptLanguage: ACCEPT_LANGUAGE,
      deviceFingerprint: DEVICE_FINGERPRINT_PAYLOAD,
      cookieHeader: [
        `${SESSION_COOKIE}=${sessionToken}`,
        `${ATTENDANCE_PROOF_COOKIE}=${attendanceProof}`,
        `${BROWSER_DEVICE_PROOF_COOKIE}=${browserProof}`,
      ].join("; "),
    });
  }

  return fixtures;
}

async function main() {
  const organization = await prisma.organization.findUnique({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true, slug: true },
  });

  if (!organization) {
    fail(`Organization "${ORG_SLUG}" was not found.`);
  }

  const passwordHash = await argon2.hash(PASSWORD, ARGON2_HASH_OPTIONS);
  const fingerprintHash = createBrowserFingerprintHash(DEVICE_FINGERPRINT_PAYLOAD);
  const students = await createUsers(passwordHash, organization.id);
  const { lecturer, course } = await ensureLecturerAndCourse(organization.id, passwordHash);

  await prepareStudentArtifacts(students, course.id, fingerprintHash);
  const { session, prerequisiteSessionId } = await createAttendanceSessions(course, students);
  const fixtures = await buildUserFixtures(students, fingerprintHash);

  await mkdir(FIXTURES_DIR, { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify(fixtures, null, 2));

  const metadata = {
    generatedAt: new Date().toISOString(),
    organization: organization.slug,
    courseCode: course.code,
    courseName: course.name,
    lecturerEmail: lecturer.email,
    userCount: fixtures.length,
    phase: session.phase,
    sessionId: session.id,
    sessionFamilyId: session.sessionFamilyId,
    prerequisiteSessionId,
    qrSecret: session.qrSecret,
    startedAt: session.startedAt,
    endsAt: session.endsAt,
    usersFile: USERS_FILE,
    recommendedCommand:
      `k6 run load-tests/attendance-burst.js ` +
      `-e BASE_URL=${shellQuote(LOAD_TEST_BASE_URL)} ` +
      `-e USERS_FILE=${shellQuote(USERS_FILE)} ` +
      `-e SESSION_ID=${shellQuote(session.id)} ` +
      `-e QR_SECRET=${shellQuote(session.qrSecret)} ` +
      `-e PHASE=${shellQuote(session.phase)} ` +
      `-e ONE_SHOT=true ` +
      `-e QR_VUS=5000 -e BLE_VUS=0 -e READ_VUS=0`,
  };

  await writeFile(META_FILE, JSON.stringify(metadata, null, 2));
  await writeFile(COMMAND_FILE, `${metadata.recommendedCommand}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        organization: organization.name,
        courseCode: course.code,
        lecturerEmail: lecturer.email,
        userCount: fixtures.length,
        phase: session.phase,
        sessionId: session.id,
        prerequisiteSessionId,
        usersFile: USERS_FILE,
        metaFile: META_FILE,
        commandFile: COMMAND_FILE,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
