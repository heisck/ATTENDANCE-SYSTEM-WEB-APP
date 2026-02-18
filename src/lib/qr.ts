import crypto from "crypto";
import type { QRPayload } from "@/types";

const BUCKET_INTERVAL_MS = 5000;
const TOLERANCE_BUCKETS = 2;

export function generateQrSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getTimeBucket(timestamp?: number): number {
  const ts = timestamp || Date.now();
  return Math.floor(ts / BUCKET_INTERVAL_MS);
}

export function generateQrToken(secret: string, bucket?: number): string {
  const b = bucket ?? getTimeBucket();
  return crypto
    .createHmac("sha256", secret)
    .update(String(b))
    .digest("hex")
    .slice(0, 16);
}

export function generateQrPayload(
  sessionId: string,
  secret: string
): QRPayload {
  const ts = Date.now();
  const bucket = getTimeBucket(ts);
  const token = generateQrToken(secret, bucket);
  return { sessionId, token, ts };
}

export function verifyQrToken(
  secret: string,
  token: string,
  timestamp: number
): boolean {
  const bucket = getTimeBucket(timestamp);

  for (let offset = 0; offset <= TOLERANCE_BUCKETS; offset++) {
    const expected = generateQrToken(secret, bucket - offset);
    if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return true;
    }
  }

  return false;
}

export function getNextRotationMs(): number {
  const now = Date.now();
  const currentBucket = getTimeBucket(now);
  const nextBucketStart = (currentBucket + 1) * BUCKET_INTERVAL_MS;
  return nextBucketStart - now;
}
