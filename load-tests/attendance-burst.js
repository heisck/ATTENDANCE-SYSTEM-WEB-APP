import http from "k6/http";
import { check, fail } from "k6";
import crypto from "k6/crypto";
import { SharedArray } from "k6/data";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SESSION_ID = __ENV.SESSION_ID || "";
const QR_SECRET = __ENV.QR_SECRET || "";
const PHASE = __ENV.PHASE || "PHASE_ONE";
const ROTATION_MS = Number(__ENV.ROTATION_MS || 5000);
const DEFAULT_USER_AGENT =
  __ENV.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const DEFAULT_ACCEPT_LANGUAGE = __ENV.ACCEPT_LANGUAGE || "en-US,en;q=0.9";
const USERS_FILE = __ENV.USERS_FILE || "";
const ONE_SHOT = String(__ENV.ONE_SHOT || "").toLowerCase() === "true";

function readJsonFile(fileEnvName) {
  const filePath = __ENV[fileEnvName];
  if (!filePath) return [];

  return new SharedArray(`${fileEnvName}:${filePath}`, () => {
    const parsed = JSON.parse(open(filePath));
    if (!Array.isArray(parsed)) {
      fail(`${fileEnvName} must contain a JSON array.`);
    }
    return parsed;
  });
}

function readUsers() {
  if (!USERS_FILE) return [];

  return new SharedArray(`USERS_FILE:${USERS_FILE}`, () => {
    const parsed = JSON.parse(open(USERS_FILE));
    if (!Array.isArray(parsed)) {
      fail("USERS_FILE must contain a JSON array.");
    }
    return parsed;
  });
}

const users = readUsers();
const qrCookieHeaders = readJsonFile("QR_COOKIE_HEADERS_FILE");
const bleCookieHeaders = readJsonFile("BLE_COOKIE_HEADERS_FILE");
const readCookieHeadersList = readJsonFile("READ_COOKIE_HEADERS_FILE");

if (!SESSION_ID || !QR_SECRET) {
  fail("Set SESSION_ID and QR_SECRET before running the attendance burst test.");
}

function requireCookieHeaders(headers, name) {
  if (!headers.length) {
    fail(`Provide ${name} with a JSON array of full Cookie header strings.`);
  }
  return headers;
}

if (!users.length) {
  requireCookieHeaders(qrCookieHeaders, "QR_COOKIE_HEADERS_FILE");
  requireCookieHeaders(
    bleCookieHeaders.length ? bleCookieHeaders : qrCookieHeaders,
    "BLE_COOKIE_HEADERS_FILE or QR_COOKIE_HEADERS_FILE"
  );
  requireCookieHeaders(
    readCookieHeadersList.length ? readCookieHeadersList : qrCookieHeaders,
    "READ_COOKIE_HEADERS_FILE or QR_COOKIE_HEADERS_FILE"
  );
}

function buildScenario(config) {
  if (config.target <= 0) {
    return null;
  }

  if (ONE_SHOT) {
    return {
      executor: "per-vu-iterations",
      exec: config.exec,
      vus: config.target,
      iterations: 1,
      startTime: config.startTime,
      maxDuration: config.maxDuration || __ENV.ONE_SHOT_MAX_DURATION || "5m",
      gracefulStop: "0s",
    };
  }

  return {
    executor: "ramping-vus",
    exec: config.exec,
    startTime: config.startTime,
    startVUs: 0,
    stages: [
      { duration: config.rampDuration, target: config.target },
      { duration: config.holdDuration, target: config.holdTarget },
      { duration: config.cooldownDuration, target: 0 },
    ],
  };
}

const scenarios = Object.fromEntries(
  Object.entries({
    qr_mark_burst: buildScenario({
      exec: "qrMark",
      target: Number(__ENV.QR_VUS || 2000),
      startTime: "0s",
      rampDuration: __ENV.QR_RAMP_DURATION || "30s",
      holdDuration: __ENV.QR_HOLD_DURATION || "10s",
      holdTarget: Number(__ENV.QR_HOLD_VUS || 0),
      cooldownDuration: __ENV.QR_COOLDOWN_DURATION || "10s",
    }),
    ble_mark_burst: buildScenario({
      exec: "bleMark",
      target: Number(__ENV.BLE_VUS || 500),
      startTime: __ENV.BLE_START_TIME || "0s",
      rampDuration: __ENV.BLE_RAMP_DURATION || "30s",
      holdDuration: __ENV.BLE_HOLD_DURATION || "10s",
      holdTarget: Number(__ENV.BLE_HOLD_VUS || 0),
      cooldownDuration: __ENV.BLE_COOLDOWN_DURATION || "10s",
    }),
    session_reads: buildScenario({
      exec: "readEndpoints",
      target: Number(__ENV.READ_VUS || 250),
      startTime: __ENV.READ_START_TIME || "0s",
      rampDuration: __ENV.READ_RAMP_DURATION || "30s",
      holdDuration: __ENV.READ_HOLD_DURATION || "10s",
      holdTarget: Number(__ENV.READ_HOLD_VUS || 0),
      cooldownDuration: __ENV.READ_COOLDOWN_DURATION || "10s",
    }),
  }).filter(([, value]) => value)
);

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

function getCookieHeader(headers, offset = 0) {
  return headers[((__VU - 1 + offset) % headers.length + headers.length) % headers.length];
}

function getUser(offset = 0) {
  if (!users.length) {
    return null;
  }

  return users[((__VU - 1 + offset) % users.length + users.length) % users.length];
}

function getQrSequence(timestamp, rotationMs = ROTATION_MS) {
  return Math.floor(timestamp / rotationMs);
}

function generatePhaseBoundQrToken(secret, phase, sequence) {
  return crypto.hmac("sha256", secret, `QR:${phase}:${sequence}`, "hex").slice(0, 16);
}

function generatePhaseBoundBleToken(secret, phase, sequence) {
  return crypto.hmac("sha256", secret, `BLE:${phase}:${sequence}`, "hex").slice(0, 16);
}

function buildQrPayload(nowTs) {
  const sequence = getQrSequence(nowTs, ROTATION_MS);
  return {
    sessionId: SESSION_ID,
    token: generatePhaseBoundQrToken(QR_SECRET, PHASE, sequence),
    ts: nowTs,
    seq: sequence,
    phase: PHASE,
  };
}

function buildBlePayload(nowTs) {
  const sequence = getQrSequence(nowTs, ROTATION_MS);
  return {
    sessionId: SESSION_ID,
    token: generatePhaseBoundBleToken(QR_SECRET, PHASE, sequence),
    ts: nowTs,
    seq: sequence,
    phase: PHASE,
  };
}

function buildCommonHeaders(cookieHeader, user) {
  return {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    "User-Agent": user?.userAgent || DEFAULT_USER_AGENT,
    "Accept-Language": user?.acceptLanguage || DEFAULT_ACCEPT_LANGUAGE,
  };
}

function buildDevicePayload(prefix, user) {
  if (user) {
    return {
      deviceToken: user.deviceToken,
      deviceName: user.deviceName || `k6-${prefix}-${__VU}`,
      deviceType: user.deviceType || "Web",
      osVersion: user.osVersion,
      appVersion: user.appVersion || "k6",
      deviceFingerprint: user.deviceFingerprint,
      bleSignature: user.bleSignature,
    };
  }

  return {
    deviceToken: `${prefix}-${__VU}`,
    deviceName: `k6-${prefix}-${__VU}`,
    deviceType: "Web",
    appVersion: "k6",
    deviceFingerprint: JSON.stringify({
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
    }),
  };
}

export function qrMark() {
  const nowTs = Date.now();
  const qrPayload = buildQrPayload(nowTs);
  const offset = Number(__ENV.QR_USER_OFFSET || 0);
  const user = getUser(offset);
  const cookieHeader = user ? user.cookieHeader : getCookieHeader(qrCookieHeaders, offset);
  const response = http.post(
    `${BASE_URL}/api/attendance/mark`,
    JSON.stringify({
      sessionId: qrPayload.sessionId,
      qrToken: qrPayload.token,
      qrTimestamp: nowTs,
      ...buildDevicePayload("qr", user),
    }),
    {
      headers: buildCommonHeaders(cookieHeader, user),
      tags: { endpoint: "attendance-mark", mode: "qr" },
    }
  );

  check(response, {
    "qr mark accepted or already marked": (res) => res.status === 200 || res.status === 409,
  });
}

export function bleMark() {
  const nowTs = Date.now();
  const blePayload = buildBlePayload(nowTs);
  const offset = Number(__ENV.BLE_USER_OFFSET || 0);
  const user = getUser(offset);
  const cookieHeader = user
    ? user.cookieHeader
    : getCookieHeader(bleCookieHeaders.length ? bleCookieHeaders : qrCookieHeaders, offset);
  const response = http.post(
    `${BASE_URL}/api/attendance/ble-mark`,
    JSON.stringify({
      sessionId: blePayload.sessionId,
      token: blePayload.token,
      sequence: blePayload.seq,
      phase: blePayload.phase,
      tokenTimestamp: nowTs,
      beaconName: `ATD-K6-${SESSION_ID.slice(-4).toUpperCase()}`,
      ...buildDevicePayload("ble", user),
    }),
    {
      headers: buildCommonHeaders(cookieHeader, user),
      tags: { endpoint: "attendance-ble-mark", mode: "ble" },
    }
  );

  check(response, {
    "ble mark accepted or already marked": (res) => res.status === 200 || res.status === 409,
  });
}

export function readEndpoints() {
  const offset = Number(__ENV.READ_USER_OFFSET || 0);
  const user = getUser(offset);
  const cookieHeader = user
    ? user.cookieHeader
    : getCookieHeader(
        readCookieHeadersList.length ? readCookieHeadersList : qrCookieHeaders,
        offset
      );

  const listResponse = http.get(`${BASE_URL}/api/attendance/sessions?status=ACTIVE`, {
    headers: buildCommonHeaders(cookieHeader, user),
    tags: { endpoint: "attendance-sessions-list", mode: "read" },
  });
  check(listResponse, {
    "sessions list ok": (res) => res.status === 200,
  });

  const syncResponse = http.get(`${BASE_URL}/api/attendance/sessions/${SESSION_ID}/me`, {
    headers: buildCommonHeaders(cookieHeader, user),
    tags: { endpoint: "attendance-session-me", mode: "read" },
  });
  check(syncResponse, {
    "session me ok": (res) => res.status === 200 || res.status === 410,
  });
}
