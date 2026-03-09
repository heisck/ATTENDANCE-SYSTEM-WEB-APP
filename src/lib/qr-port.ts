/**
 * QR Port - Students who complete attendance can request to display the live QR
 * on their device for friends with bad cameras. Lecturer must approve.
 */

import { db } from "./db";
import { syncAttendanceSessionState, getPhaseEndsAt } from "./attendance";
import {
  formatQrSequenceId,
  generateQrPayloadForSequence,
  getQrSequence,
} from "./qr";
import { cacheGet, cacheGetOrCompute, cacheSet } from "./cache";

export async function requestQrPort(sessionId: string, studentId: string) {
  const session = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      status: true,
      course: {
        select: {
          enrollments: {
            where: { studentId },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!session || session.status !== "ACTIVE") {
    return { success: false, message: "Session not found or closed" };
  }
  if (session.course.enrollments.length === 0) {
    return {
      success: false,
      message: "You are not enrolled in this course",
    };
  }

  const attendance = await db.attendanceRecord.findUnique({
    where: { sessionId_studentId: { sessionId, studentId } },
    select: { id: true },
  });
  if (!attendance) {
    return {
      success: false,
      message: "Complete your attendance verification first",
    };
  }

  const existing = await db.qrPortRequest.findUnique({
    where: { sessionId_studentId: { sessionId, studentId } },
    select: { status: true },
  });
  if (existing) {
    if (existing.status === "APPROVED") {
      return { success: true, status: "APPROVED", message: "QR port already approved" };
    }
    if (existing.status === "PENDING") {
      return { success: true, status: "PENDING", message: "Request pending lecturer approval" };
    }
    return { success: false, message: "Request was previously rejected" };
  }

  await db.qrPortRequest.create({
    data: { sessionId, studentId, status: "PENDING" },
  });
  await cacheSet(`attendance:qr-port-status:${sessionId}:${studentId}`, "PENDING", 3);
  return { success: true, status: "PENDING", message: "Request sent. Lecturer will be notified." };
}

export async function getQrPortStatus(sessionId: string, studentId: string) {
  const cacheKey = `attendance:qr-port-status:${sessionId}:${studentId}`;
  const cached = await cacheGet<string | null>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const req = await db.qrPortRequest.findUnique({
    where: { sessionId_studentId: { sessionId, studentId } },
    select: { status: true },
  });
  const status = req?.status ?? null;
  await cacheSet(cacheKey, status, 3);
  return status;
}

export async function getLiveQrForPort(sessionId: string, studentId: string) {
  const req = await db.qrPortRequest.findUnique({
    where: { sessionId_studentId: { sessionId, studentId } },
    select: { status: true },
  });
  if (!req || req.status !== "APPROVED") {
    return null;
  }

  const syncedSession = await syncAttendanceSessionState(sessionId);
  if (!syncedSession || syncedSession.status !== "ACTIVE") {
    return null;
  }

  const attendanceSession = await cacheGetOrCompute(
    `attendance:session-secret:${sessionId}`,
    120,
    async () =>
      db.attendanceSession.findUnique({
        where: { id: sessionId },
        select: { id: true, qrSecret: true },
      })
  );
  if (!attendanceSession) return null;

  const nowTs = Date.now();
  const currentSequence = getQrSequence(nowTs, syncedSession.qrRotationMs);
  const sequenceCacheKey = `attendance:qr-port:${sessionId}:${syncedSession.phase}:${currentSequence}`;
  const cached = await cacheGet<any>(sequenceCacheKey);
  if (cached) {
    return cached;
  }

  const nextRotationAtTs = (currentSequence + 1) * syncedSession.qrRotationMs;
  const nextRotation = Math.max(0, nextRotationAtTs - nowTs);
  const qr = generateQrPayloadForSequence(
    attendanceSession.id,
    attendanceSession.qrSecret,
    syncedSession.phase,
    currentSequence,
    syncedSession.qrRotationMs,
    nowTs
  );
  const nextQr = generateQrPayloadForSequence(
    attendanceSession.id,
    attendanceSession.qrSecret,
    syncedSession.phase,
    currentSequence + 1,
    syncedSession.qrRotationMs,
    nextRotationAtTs
  );
  const sequenceId = formatQrSequenceId(currentSequence);
  const nextSequenceId = formatQrSequenceId(currentSequence + 1);
  const cueColor = syncedSession.phase === "REVERIFY" ? "blue" : "green";

  const payload = {
    qr,
    nextQr,
    sequenceId,
    nextSequenceId,
    cueColor,
    phase: syncedSession.phase,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
    rotationMs: syncedSession.qrRotationMs,
    nextRotationMs: nextRotation,
    nextRotationAtTs,
    serverNowTs: nowTs,
  };
  await cacheSet(sequenceCacheKey, payload, 2);
  return payload;
}

export async function listQrPortRequests(sessionId: string) {
  return db.qrPortRequest.findMany({
    where: { sessionId },
    include: { student: { select: { id: true, name: true, email: true } } },
    orderBy: { requestedAt: "desc" },
  });
}

export async function approveQrPort(qrPortRequestId: string, lecturerId: string) {
  const req = await db.qrPortRequest.findUnique({
    where: { id: qrPortRequestId },
    include: { session: { select: { lecturerId: true } } },
  });
  if (!req || req.session.lecturerId !== lecturerId) {
    return { success: false, message: "Not found or unauthorized" };
  }
  await db.qrPortRequest.update({
    where: { id: qrPortRequestId },
    data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: lecturerId },
  });
  await cacheSet(
    `attendance:qr-port-status:${req.sessionId}:${req.studentId}`,
    "APPROVED",
    3
  );
  return { success: true, message: "QR port approved" };
}

export async function rejectQrPort(qrPortRequestId: string, lecturerId: string) {
  const req = await db.qrPortRequest.findUnique({
    where: { id: qrPortRequestId },
    include: { session: { select: { lecturerId: true } } },
  });
  if (!req || req.session.lecturerId !== lecturerId) {
    return { success: false, message: "Not found or unauthorized" };
  }
  await db.qrPortRequest.update({
    where: { id: qrPortRequestId },
    data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: lecturerId },
  });
  await cacheSet(
    `attendance:qr-port-status:${req.sessionId}:${req.studentId}`,
    "REJECTED",
    3
  );
  return { success: true, message: "QR port rejected" };
}
