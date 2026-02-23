import crypto from "crypto";

export const DEFAULT_TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutes

export function createRawToken(byteLength: number = 32): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function createExpiryDate(ttlMs: number = DEFAULT_TOKEN_TTL_MS): Date {
  return new Date(Date.now() + ttlMs);
}
