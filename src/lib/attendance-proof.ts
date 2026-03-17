import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const ATTENDANCE_PROOF_COOKIE = "attendance_proof";
const ATTENDANCE_PROOF_TTL_SECONDS = 10 * 60;

type AttendanceProofPayload = {
  userId: string;
  iat: number;
  exp: number;
};

export class AttendanceProofRequiredError extends Error {
  constructor() {
    super("Verify your passkey before attendance.");
    this.name = "AttendanceProofRequiredError";
  }
}

function getAttendanceProofSecret() {
  const secret =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "development-attendance-proof-secret"
      : null);

  if (!secret) {
    throw new Error("AUTH_SECRET or NEXTAUTH_SECRET is required for attendance proof cookies");
  }

  return secret;
}

function signAttendanceProofPayload(payload: string) {
  return createHmac("sha256", getAttendanceProofSecret())
    .update(payload)
    .digest("base64url");
}

function decodeAttendanceProofPayload(token: string): AttendanceProofPayload | null {
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = signAttendanceProofPayload(encodedPayload);

  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as AttendanceProofPayload;

    if (
      typeof payload.userId !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function createAttendanceProofToken(userId: string, nowMs: number = Date.now()) {
  const payload: AttendanceProofPayload = {
    userId,
    iat: nowMs,
    exp: nowMs + ATTENDANCE_PROOF_TTL_SECONDS * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signAttendanceProofPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyAttendanceProofToken(
  token: string | null | undefined,
  userId: string,
  nowMs: number = Date.now()
) {
  if (!token) return false;

  const payload = decodeAttendanceProofPayload(token);
  if (!payload) return false;
  if (payload.userId !== userId) return false;
  if (payload.exp <= nowMs) return false;
  return true;
}

export function getAttendanceProofCookieName() {
  return ATTENDANCE_PROOF_COOKIE;
}

export function setAttendanceProofCookie(response: NextResponse, userId: string) {
  response.cookies.set({
    name: ATTENDANCE_PROOF_COOKIE,
    value: createAttendanceProofToken(userId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ATTENDANCE_PROOF_TTL_SECONDS,
  });
}

export function clearAttendanceProofCookie(response: NextResponse) {
  response.cookies.set({
    name: ATTENDANCE_PROOF_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function hasValidAttendanceProof(request: NextRequest, userId: string) {
  const token = request.cookies.get(ATTENDANCE_PROOF_COOKIE)?.value;
  return verifyAttendanceProofToken(token, userId);
}

export function requireAttendanceProof(request: NextRequest, userId: string) {
  if (!hasValidAttendanceProof(request, userId)) {
    throw new AttendanceProofRequiredError();
  }
}
