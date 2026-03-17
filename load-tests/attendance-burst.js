import http from "k6/http";
import { check, fail } from "k6";
import crypto from "k6/crypto";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SESSION_ID = __ENV.SESSION_ID || "";
const QR_SECRET = __ENV.QR_SECRET || "";
const PHASE = __ENV.PHASE || "PHASE_ONE";
const ROTATION_MS = Number(__ENV.ROTATION_MS || 5000);

function readCookieHeaders(fileEnvName) {
  const filePath = __ENV[fileEnvName];
  if (!filePath) return [];
  return JSON.parse(open(filePath));
}

const qrCookieHeaders = readCookieHeaders("QR_COOKIE_HEADERS_FILE");
const bleCookieHeaders = readCookieHeaders("BLE_COOKIE_HEADERS_FILE");
const readCookieHeadersList = readCookieHeaders("READ_COOKIE_HEADERS_FILE");

if (!SESSION_ID || !QR_SECRET) {
  fail("Set SESSION_ID and QR_SECRET before running the attendance burst test.");
}

function requireCookieHeaders(headers, name) {
  if (!headers.length) {
    fail(`Provide ${name} with a JSON array of full Cookie header strings.`);
  }
  return headers;
}

requireCookieHeaders(qrCookieHeaders, "QR_COOKIE_HEADERS_FILE");
requireCookieHeaders(
  bleCookieHeaders.length ? bleCookieHeaders : qrCookieHeaders,
  "BLE_COOKIE_HEADERS_FILE or QR_COOKIE_HEADERS_FILE"
);
requireCookieHeaders(
  readCookieHeadersList.length ? readCookieHeadersList : qrCookieHeaders,
  "READ_COOKIE_HEADERS_FILE or QR_COOKIE_HEADERS_FILE"
);

export const options = {
  scenarios: {
    qr_mark_burst: {
      executor: "ramping-vus",
      exec: "qrMark",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Number(__ENV.QR_VUS || 2000) },
        { duration: "10s", target: 0 },
      ],
    },
    ble_mark_burst: {
      executor: "ramping-vus",
      exec: "bleMark",
      startTime: "0s",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Number(__ENV.BLE_VUS || 500) },
        { duration: "10s", target: 0 },
      ],
    },
    session_reads: {
      executor: "ramping-vus",
      exec: "readEndpoints",
      startTime: "0s",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Number(__ENV.READ_VUS || 250) },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

function getCookieHeader(headers) {
  return headers[(__VU - 1) % headers.length];
}

function getQrSequence(timestamp, rotationMs = ROTATION_MS) {
  return Math.floor(timestamp / rotationMs);
}

function generatePhaseBoundQrToken(secret, phase, sequence) {
  return crypto.hmac("sha256", secret, `${phase}:${sequence}`, "hex").slice(0, 16);
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

function buildCommonHeaders(cookieHeader) {
  return {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
  };
}

function buildDevicePayload(prefix) {
  return {
    deviceToken: `${prefix}-${__VU}`,
    deviceName: `k6-${prefix}-${__VU}`,
    deviceType: "Web",
    appVersion: "k6",
    deviceFingerprint: `k6|${prefix}|${__VU}`,
  };
}

export function qrMark() {
  const nowTs = Date.now();
  const qrPayload = buildQrPayload(nowTs);
  const cookieHeader = getCookieHeader(qrCookieHeaders);
  const response = http.post(
    `${BASE_URL}/api/attendance/mark`,
    JSON.stringify({
      sessionId: qrPayload.sessionId,
      qrToken: qrPayload.token,
      qrTimestamp: nowTs,
      ...buildDevicePayload("qr"),
    }),
    {
      headers: buildCommonHeaders(cookieHeader),
      tags: { endpoint: "attendance-mark", mode: "qr" },
    }
  );

  check(response, {
    "qr mark accepted or already marked": (res) => res.status === 200 || res.status === 409,
  });
}

export function bleMark() {
  const nowTs = Date.now();
  const qrPayload = buildQrPayload(nowTs);
  const cookieHeader = getCookieHeader(
    bleCookieHeaders.length ? bleCookieHeaders : qrCookieHeaders
  );
  const response = http.post(
    `${BASE_URL}/api/attendance/ble-mark`,
    JSON.stringify({
      sessionId: qrPayload.sessionId,
      token: qrPayload.token,
      sequence: qrPayload.seq,
      phase: qrPayload.phase,
      tokenTimestamp: nowTs,
      beaconName: `ATD-K6-${SESSION_ID.slice(-4).toUpperCase()}`,
      bleSignalStrength: -60,
      ...buildDevicePayload("ble"),
    }),
    {
      headers: buildCommonHeaders(cookieHeader),
      tags: { endpoint: "attendance-ble-mark", mode: "ble" },
    }
  );

  check(response, {
    "ble mark accepted or already marked": (res) => res.status === 200 || res.status === 409,
  });
}

export function readEndpoints() {
  const cookieHeader = getCookieHeader(
    readCookieHeadersList.length ? readCookieHeadersList : qrCookieHeaders
  );

  const listResponse = http.get(
    `${BASE_URL}/api/attendance/sessions?status=ACTIVE`,
    {
      headers: buildCommonHeaders(cookieHeader),
      tags: { endpoint: "attendance-sessions-list", mode: "read" },
    }
  );
  check(listResponse, {
    "sessions list ok": (res) => res.status === 200,
  });

  const syncResponse = http.get(
    `${BASE_URL}/api/attendance/sessions/${SESSION_ID}/me`,
    {
      headers: buildCommonHeaders(cookieHeader),
      tags: { endpoint: "attendance-session-me", mode: "read" },
    }
  );
  check(syncResponse, {
    "session me ok": (res) => res.status === 200 || res.status === 410,
  });
}
