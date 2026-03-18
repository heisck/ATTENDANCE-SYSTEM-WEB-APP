import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const BROWSER_DEVICE_PROOF_COOKIE = "attendance_browser_device";
const BROWSER_DEVICE_PROOF_TTL_SECONDS = 90 * 24 * 60 * 60;

type BrowserDeviceProofPayload = {
  version: 1;
  userId: string;
  deviceToken: string;
  fingerprintHash: string;
  iat: number;
  exp: number;
};

type NormalizedBrowserFingerprint = {
  version: 1;
  userAgent: string;
  acceptLanguage: string;
  platform: string;
  language: string;
  languages: string[];
  timezone: string;
  screen: string;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  touchPoints: number | null;
  vendor: string;
  cookieEnabled: boolean;
  colorScheme: "light" | "dark" | "no-preference" | "unknown";
};

function getBrowserDeviceProofSecret() {
  const secret =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "development-browser-device-proof-secret"
      : null);

  if (!secret) {
    throw new Error(
      "AUTH_SECRET or NEXTAUTH_SECRET is required for browser device proof cookies"
    );
  }

  return secret;
}

function signBrowserDeviceProofPayload(payload: string) {
  return createHmac("sha256", getBrowserDeviceProofSecret())
    .update(payload)
    .digest("base64url");
}

function sanitizeString(value: unknown, maxLength: number, fallback = "unknown") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, maxLength) : fallback;
}

function sanitizeStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => sanitizeString(item, maxLength, ""))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function sanitizeNullableNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function sanitizeBoolean(value: unknown) {
  return value === true;
}

function normalizeColorScheme(value: unknown): NormalizedBrowserFingerprint["colorScheme"] {
  if (value === "light" || value === "dark" || value === "no-preference") {
    return value;
  }

  return "unknown";
}

function decodeBrowserDeviceProofPayload(
  token: string
): BrowserDeviceProofPayload | null {
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = signBrowserDeviceProofPayload(encodedPayload);

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
    ) as BrowserDeviceProofPayload;

    if (
      payload.version !== 1 ||
      typeof payload.userId !== "string" ||
      typeof payload.deviceToken !== "string" ||
      typeof payload.fingerprintHash !== "string" ||
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

function normalizeBrowserFingerprintPayload(
  request: NextRequest,
  rawFingerprint: string
): NormalizedBrowserFingerprint | null {
  if (rawFingerprint.length === 0 || rawFingerprint.length > 4_096) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawFingerprint) as Record<string, unknown>;
    return {
      version: 1,
      userAgent: sanitizeString(request.headers.get("user-agent"), 240),
      acceptLanguage: sanitizeString(
        request.headers.get("accept-language")?.split(",").slice(0, 2).join(","),
        80
      ),
      platform: sanitizeString(parsed.platform, 80),
      language: sanitizeString(parsed.language, 32),
      languages: sanitizeStringArray(parsed.languages, 5, 32),
      timezone: sanitizeString(parsed.timezone, 80),
      screen: sanitizeString(parsed.screen, 32),
      hardwareConcurrency: sanitizeNullableNumber(parsed.hardwareConcurrency),
      deviceMemory: sanitizeNullableNumber(parsed.deviceMemory),
      touchPoints: sanitizeNullableNumber(parsed.touchPoints),
      vendor: sanitizeString(parsed.vendor, 80),
      cookieEnabled: sanitizeBoolean(parsed.cookieEnabled),
      colorScheme: normalizeColorScheme(parsed.colorScheme),
    };
  } catch {
    return null;
  }
}

export function createBrowserFingerprintHash(
  request: NextRequest,
  rawFingerprint: string | null | undefined
) {
  if (!rawFingerprint) {
    return null;
  }

  const normalized = normalizeBrowserFingerprintPayload(request, rawFingerprint);
  if (!normalized) {
    return null;
  }

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("base64url");
}

export function extractBrowserDeviceBinding(
  request: NextRequest,
  body: Record<string, unknown> | null | undefined
) {
  const deviceToken =
    typeof body?.deviceToken === "string" ? body.deviceToken.trim().slice(0, 160) : "";
  const fingerprintHash = createBrowserFingerprintHash(
    request,
    typeof body?.deviceFingerprint === "string" ? body.deviceFingerprint : undefined
  );

  if (!deviceToken || !fingerprintHash) {
    return null;
  }

  return {
    deviceToken,
    fingerprintHash,
  };
}

export function createBrowserDeviceProofToken(
  userId: string,
  deviceToken: string,
  fingerprintHash: string,
  nowMs: number = Date.now()
) {
  const payload: BrowserDeviceProofPayload = {
    version: 1,
    userId,
    deviceToken,
    fingerprintHash,
    iat: nowMs,
    exp: nowMs + BROWSER_DEVICE_PROOF_TTL_SECONDS * 1000,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signBrowserDeviceProofPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyBrowserDeviceProofToken(
  token: string | null | undefined,
  input: {
    userId: string;
    deviceToken: string;
    fingerprintHash: string;
    nowMs?: number;
  }
) {
  if (!token) {
    return false;
  }

  const payload = decodeBrowserDeviceProofPayload(token);
  if (!payload) {
    return false;
  }

  const nowMs = input.nowMs ?? Date.now();

  return (
    payload.userId === input.userId &&
    payload.deviceToken === input.deviceToken &&
    payload.fingerprintHash === input.fingerprintHash &&
    payload.exp > nowMs
  );
}

export function hasValidBrowserDeviceProof(
  request: NextRequest,
  input: {
    userId: string;
    deviceToken: string;
    fingerprintHash: string;
  }
) {
  const token = request.cookies.get(BROWSER_DEVICE_PROOF_COOKIE)?.value;
  return verifyBrowserDeviceProofToken(token, input);
}

export function setBrowserDeviceProofCookie(
  response: NextResponse,
  input: {
    userId: string;
    deviceToken: string;
    fingerprintHash: string;
  }
) {
  response.cookies.set({
    name: BROWSER_DEVICE_PROOF_COOKIE,
    value: createBrowserDeviceProofToken(
      input.userId,
      input.deviceToken,
      input.fingerprintHash
    ),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: BROWSER_DEVICE_PROOF_TTL_SECONDS,
  });
}

export function clearBrowserDeviceProofCookie(response: NextResponse) {
  response.cookies.set({
    name: BROWSER_DEVICE_PROOF_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
