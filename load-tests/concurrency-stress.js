/**
 * CONCURRENCY STRESS TEST
 * Tests system capacity across multiple endpoint types simultaneously.
 *
 * Scenarios:
 *   1. Health probes     — load balancer simulation (constant)
 *   2. Auth storm        — login burst (ramp up)
 *   3. API reads         — dashboard/hub GET requests (sustained)
 *   4. API writes        — simulated attendance marking (burst)
 *
 * Usage:
 *   k6 run load-tests/concurrency-stress.js
 *   k6 run load-tests/concurrency-stress.js --env TARGET_VUS=5000 --env BASE_URL=http://localhost:3000
 *   k6 run load-tests/concurrency-stress.js --env TARGET_VUS=500 --env RAMP_DURATION=15s
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";

// ─── Configuration ───────────────────────────────────────────────────────────
const BASE_URL = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const TARGET_VUS = Number(__ENV.TARGET_VUS || 1000);
const RAMP_DURATION = __ENV.RAMP_DURATION || "30s";
const HOLD_DURATION = __ENV.HOLD_DURATION || "60s";
const COOLDOWN_DURATION = __ENV.COOLDOWN_DURATION || "10s";

// Optional: provide a valid session cookie for authenticated endpoint testing
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";
// Optional: provide session ID + QR secret for attendance marking tests
const SESSION_ID = __ENV.SESSION_ID || "";
const QR_SECRET = __ENV.QR_SECRET || "";

// ─── Custom metrics ──────────────────────────────────────────────────────────
const healthErrors = new Rate("health_errors");
const authErrors = new Rate("auth_errors");
const readErrors = new Rate("read_errors");
const writeErrors = new Rate("write_errors");
const totalRequests = new Counter("total_requests");
const healthLatency = new Trend("health_latency", true);
const authLatency = new Trend("auth_latency", true);
const readLatency = new Trend("read_latency", true);
const writeLatency = new Trend("write_latency", true);

// ─── VU distribution (% of TARGET_VUS) ──────────────────────────────────────
const HEALTH_RATIO = 0.05;  // 5% — health probes
const AUTH_RATIO = 0.25;    // 25% — auth attempts
const READ_RATIO = 0.45;    // 45% — GET requests (largest share)
const WRITE_RATIO = 0.25;   // 25% — POST requests

function vuCount(ratio) {
  return Math.max(1, Math.round(TARGET_VUS * ratio));
}

// ─── Scenarios ───────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    health_probes: {
      executor: "constant-vus",
      exec: "healthCheck",
      vus: vuCount(HEALTH_RATIO),
      duration: HOLD_DURATION,
      startTime: "0s",
    },
    auth_storm: {
      executor: "ramping-vus",
      exec: "authStorm",
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: vuCount(AUTH_RATIO) },
        { duration: HOLD_DURATION, target: vuCount(AUTH_RATIO) },
        { duration: COOLDOWN_DURATION, target: 0 },
      ],
      startTime: "0s",
    },
    api_reads: {
      executor: "ramping-vus",
      exec: "apiReads",
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: vuCount(READ_RATIO) },
        { duration: HOLD_DURATION, target: vuCount(READ_RATIO) },
        { duration: COOLDOWN_DURATION, target: 0 },
      ],
      startTime: "5s",
    },
    api_writes: {
      executor: "ramping-vus",
      exec: "apiWrites",
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: vuCount(WRITE_RATIO) },
        { duration: HOLD_DURATION, target: vuCount(WRITE_RATIO) },
        { duration: COOLDOWN_DURATION, target: 0 },
      ],
      startTime: "10s",
    },
  },
  thresholds: {
    http_req_failed: [
      { threshold: "rate<0.05", abortOnFail: false },   // <5% error rate
    ],
    http_req_duration: [
      { threshold: "p(95)<3000", abortOnFail: false },  // p95 under 3s
      { threshold: "p(99)<5000", abortOnFail: false },  // p99 under 5s
    ],
    health_errors: ["rate<0.01"],           // Health endpoint must be rock solid
    health_latency: ["p(95)<500"],          // Health under 500ms p95
    auth_latency: ["p(95)<2000"],           // Auth under 2s p95
    read_latency: ["p(95)<2000"],           // Reads under 2s p95
    write_latency: ["p(95)<3000"],          // Writes under 3s p95
  },
};

const commonHeaders = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

function headersWithAuth() {
  if (!AUTH_COOKIE) return commonHeaders;
  return Object.assign({}, commonHeaders, { Cookie: AUTH_COOKIE });
}

// ─── Scenario: Health Probes ─────────────────────────────────────────────────
export function healthCheck() {
  const res = http.get(`${BASE_URL}/api/health`, {
    headers: commonHeaders,
    tags: { endpoint: "health" },
  });

  totalRequests.add(1);
  healthLatency.add(res.timings.duration);
  const passed = check(res, {
    "health 200": (r) => r.status === 200,
    "health has status": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === "healthy" || body.status === "unhealthy";
      } catch {
        return false;
      }
    },
  });
  healthErrors.add(!passed);

  sleep(0.5 + Math.random() * 0.5); // Probe every 0.5-1s
}

// ─── Scenario: Auth Storm ────────────────────────────────────────────────────
export function authStorm() {
  // Simulate login attempts with unique emails
  const email = `loadtest-${__VU}-${__ITER}@test.university.edu`;
  const res = http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    JSON.stringify({
      email: email,
      password: "LoadTest2025!SecurePassword",
    }),
    {
      headers: commonHeaders,
      tags: { endpoint: "auth-login" },
      redirects: 0,
    }
  );

  totalRequests.add(1);
  authLatency.add(res.timings.duration);
  // 200, 302 (redirect), or 401 (bad creds) are all valid — server responded
  const passed = check(res, {
    "auth responded": (r) => [200, 302, 401, 403].includes(r.status),
  });
  authErrors.add(!passed);

  // Also hit the session check endpoint
  const sessionRes = http.get(`${BASE_URL}/api/auth/session`, {
    headers: commonHeaders,
    tags: { endpoint: "auth-session" },
  });
  totalRequests.add(1);
  check(sessionRes, {
    "session check responded": (r) => r.status === 200,
  });

  sleep(0.3 + Math.random() * 0.7);
}

// ─── Scenario: API Reads ─────────────────────────────────────────────────────
export function apiReads() {
  const headers = headersWithAuth();
  const endpoints = [
    "/api/health",
  ];

  // Add authenticated endpoints if cookie is provided
  if (AUTH_COOKIE) {
    endpoints.push(
      `/api/student/live-sessions`,
      `/api/student/hub/upcoming-class`,
      `/api/student/hub/deadlines`,
      `/api/student/hub/timetable`,
      `/api/student/attendance/summary`,
      `/api/notifications`,
    );
  }

  // Hit a random endpoint from the pool
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${endpoint}`, {
    headers: headers,
    tags: { endpoint: endpoint.replace(/^\/api\//, "") },
  });

  totalRequests.add(1);
  readLatency.add(res.timings.duration);
  // 200 = success, 401 = no auth (expected without cookie), 404 = no data
  const passed = check(res, {
    "read responded": (r) => [200, 401, 404].includes(r.status),
  });
  readErrors.add(!passed);

  sleep(0.2 + Math.random() * 0.8);
}

// ─── Scenario: API Writes ────────────────────────────────────────────────────
export function apiWrites() {
  const headers = headersWithAuth();

  // Simulate various write operations
  const writeType = __ITER % 3;

  let res;
  switch (writeType) {
    case 0:
      // Simulate registration attempt (rate limited)
      res = http.post(
        `${BASE_URL}/api/auth/register`,
        JSON.stringify({
          institutionalEmail: `stress-${__VU}-${__ITER}@test.edu`,
          personalEmail: `stress-${__VU}-${__ITER}@gmail.com`,
          password: "StressTest2025!Pwd",
          firstName: "Load",
          lastName: `Test${__VU}`,
          studentId: `ST${__VU}${__ITER}`,
          indexNumber: `IX${__VU}${__ITER}`,
          organizationSlug: "test-university",
          department: "CS",
          level: 100,
          groupCode: "A",
          signupToken: "invalid-token",
        }),
        {
          headers: commonHeaders,
          tags: { endpoint: "register" },
        }
      );
      break;

    case 1:
      // Simulate forgot password (rate limited)
      res = http.post(
        `${BASE_URL}/api/auth/forgot-password`,
        JSON.stringify({
          email: `stress-${__VU}@test.edu`,
        }),
        {
          headers: commonHeaders,
          tags: { endpoint: "forgot-password" },
        }
      );
      break;

    case 2:
      // Simulate notification subscription
      if (AUTH_COOKIE) {
        res = http.post(
          `${BASE_URL}/api/notifications/subscribe`,
          JSON.stringify({
            endpoint: `https://fcm.googleapis.com/fcm/send/stress-test-${__VU}`,
            keys: {
              p256dh: "test-key-" + __VU,
              auth: "test-auth-" + __VU,
            },
          }),
          {
            headers: headers,
            tags: { endpoint: "notifications-subscribe" },
          }
        );
      } else {
        // Without auth, hit the health endpoint as a write proxy
        res = http.get(`${BASE_URL}/api/health`, {
          headers: commonHeaders,
          tags: { endpoint: "health-write-fallback" },
        });
      }
      break;
  }

  totalRequests.add(1);
  if (res) {
    writeLatency.add(res.timings.duration);
    // 200, 201, 400, 401, 403, 404, 409, 429 are all valid server responses
    const passed = check(res, {
      "write responded": (r) =>
        [200, 201, 400, 401, 403, 404, 409, 429].includes(r.status),
    });
    writeErrors.add(!passed);
  }

  sleep(0.5 + Math.random() * 1.0);
}

// ─── Summary handler ─────────────────────────────────────────────────────────
export function handleSummary(data) {
  const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `load-tests/results/concurrency-${TARGET_VUS}vus-${now}.json`;

  // Print key metrics to console
  const metrics = data.metrics || {};
  const reqDuration = metrics.http_req_duration || {};
  const reqFailed = metrics.http_req_failed || {};
  const reqs = metrics.http_reqs || {};
  const total = metrics.total_requests || {};

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║          CONCURRENCY STRESS TEST RESULTS                ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Target VUs:      ${String(TARGET_VUS).padEnd(38)}║`);
  console.log(`║  Total Requests:  ${String(total.values ? total.values.count : "N/A").padEnd(38)}║`);
  console.log(`║  Throughput:      ${String(reqs.values ? Math.round(reqs.values.rate) + " req/s" : "N/A").padEnd(38)}║`);
  console.log(`║  Error Rate:      ${String(reqFailed.values ? (reqFailed.values.rate * 100).toFixed(2) + "%" : "N/A").padEnd(38)}║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  p50 Latency:     ${String(reqDuration.values ? Math.round(reqDuration.values.med) + "ms" : "N/A").padEnd(38)}║`);
  console.log(`║  p90 Latency:     ${String(reqDuration.values ? Math.round(reqDuration.values["p(90)"]) + "ms" : "N/A").padEnd(38)}║`);
  console.log(`║  p95 Latency:     ${String(reqDuration.values ? Math.round(reqDuration.values["p(95)"]) + "ms" : "N/A").padEnd(38)}║`);
  console.log(`║  p99 Latency:     ${String(reqDuration.values ? Math.round(reqDuration.values["p(99)"]) + "ms" : "N/A").padEnd(38)}║`);
  console.log(`║  Max Latency:     ${String(reqDuration.values ? Math.round(reqDuration.values.max) + "ms" : "N/A").padEnd(38)}║`);
  console.log("╠══════════════════════════════════════════════════════════╣");

  // Per-scenario breakdown
  const hLat = metrics.health_latency || {};
  const aLat = metrics.auth_latency || {};
  const rLat = metrics.read_latency || {};
  const wLat = metrics.write_latency || {};

  console.log(`║  Health p95:      ${String(hLat.values ? Math.round(hLat.values["p(95)"]) + "ms" : "N/A").padEnd(38)}║`);
  console.log(`║  Auth p95:        ${String(aLat.values ? Math.round(aLat.values["p(95)"]) + "ms" : "N/A").padEnd(38)}║`);
  console.log(`║  Reads p95:       ${String(rLat.values ? Math.round(rLat.values["p(95)"]) + "ms" : "N/A").padEnd(38)}║`);
  console.log(`║  Writes p95:      ${String(wLat.values ? Math.round(wLat.values["p(95)"]) + "ms" : "N/A").padEnd(38)}║`);
  console.log("╠══════════════════════════════════════════════════════════╣");

  // Verdict
  const p95 = reqDuration.values ? reqDuration.values["p(95)"] : 999999;
  const errRate = reqFailed.values ? reqFailed.values.rate : 1;
  let verdict = "FAILED";
  if (errRate < 0.01 && p95 < 1000) verdict = "EXCELLENT";
  else if (errRate < 0.05 && p95 < 2000) verdict = "GOOD";
  else if (errRate < 0.10 && p95 < 3000) verdict = "ACCEPTABLE";
  else if (errRate < 0.15 && p95 < 5000) verdict = "NEEDS WORK";

  console.log(`║  VERDICT:         ${verdict.padEnd(38)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  return {
    [fileName]: JSON.stringify(data, null, 2),
    stdout: "",
  };
}
