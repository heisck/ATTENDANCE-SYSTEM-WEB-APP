/**
 * QR Port - Students who complete attendance can request to display the live QR
 * on their device for friends with bad cameras. Lecturer must approve.
 */

import { db } from "./db";
import { syncAttendanceSessionState, getPhaseEndsAt } from "./attendance";
import { generateQrPayload, getNextRotationMs } from "./qr";

export async function requestQrPort(sessionId: string, studentId: string) {
  const session = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });
  if (!session || session.status !== "ACTIVE") {
    return { success: false, message: "Session not found or closed" };
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
  return { success: true, status: "PENDING", message: "Request sent. Lecturer will be notified." };
}

export async function getQrPortStatus(sessionId: string, studentId: string) {
  const req = await db.qrPortRequest.findUnique({
    where: { sessionId_studentId: { sessionId, studentId } },
    select: { status: true },
  });
  return req?.status ?? null;
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

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, qrSecret: true },
  });
  if (!attendanceSession) return null;

  const qr = generateQrPayload(
    attendanceSession.id,
    attendanceSession.qrSecret,
    syncedSession.phase,
    syncedSession.qrRotationMs
  );
  const nextRotation = getNextRotationMs(syncedSession.qrRotationMs);
  const sequenceId = `E${String(qr.seq).padStart(3, "0")}`;
  const nextSequenceId = `E${String(qr.seq + 1).padStart(3, "0")}`;
  const cueColor = syncedSession.phase === "REVERIFY" ? "blue" : "green";

  return {
    qr,
    sequenceId,
    nextSequenceId,
    cueColor,
    phase: syncedSession.phase,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
    nextRotationMs: nextRotation,
  };
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
  return { success: true, message: "QR port rejected" };
}
