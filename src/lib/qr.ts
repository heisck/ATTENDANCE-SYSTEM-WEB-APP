import crypto from "crypto";
import { AttendancePhase } from "@prisma/client";
import type { QRPayload } from "@/types";

const DEFAULT_BUCKET_INTERVAL_MS = 5000;

export function generateQrSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function getQrSequence(timestamp: number, rotationMs: number = DEFAULT_BUCKET_INTERVAL_MS): number {
  return Math.floor(timestamp / rotationMs);
}

function generatePhaseBoundQrToken(
  secret: string,
  phase: AttendancePhase,
  sequence: number
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${phase}:${sequence}`)
    .digest("hex")
    .slice(0, 16);
}

export function generateQrPayload(
  sessionId: string,
  secret: string,
  phase: AttendancePhase,
  rotationMs: number = DEFAULT_BUCKET_INTERVAL_MS,
  nowTs: number = Date.now()
): QRPayload {
  const sequence = getQrSequence(nowTs, rotationMs);
  const token = generatePhaseBoundQrToken(secret, phase, sequence);
  return { sessionId, token, ts: nowTs, seq: sequence, phase };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyQrTokenStrict(
  secret: string,
  token: string,
  phase: AttendancePhase,
  nowTs: number,
  rotationMs: number = DEFAULT_BUCKET_INTERVAL_MS,
  graceMs: number = 1000
): boolean {
  const currentSequence = getQrSequence(nowTs, rotationMs);
  const expectedCurrent = generatePhaseBoundQrToken(secret, phase, currentSequence);
  if (safeEqual(token, expectedCurrent)) {
    return true;
  }

  // Small grace to allow in-flight requests when a QR just rotated.
  const elapsedInCurrentBucket = nowTs - currentSequence * rotationMs;
  if (elapsedInCurrentBucket <= graceMs) {
    const previousSequence = currentSequence - 1;
    const expectedPrevious = generatePhaseBoundQrToken(secret, phase, previousSequence);
    if (safeEqual(token, expectedPrevious)) {
      return true;
    }
  }

  return false;
}

export function getNextRotationMs(rotationMs: number = DEFAULT_BUCKET_INTERVAL_MS): number {
  const now = Date.now();
  const currentSequence = getQrSequence(now, rotationMs);
  const nextSequenceStart = (currentSequence + 1) * rotationMs;
  return nextSequenceStart - now;
}
