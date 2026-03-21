import { prewarmAttendanceMarkingSession } from "@/lib/attendance-marking";

export const ATTENDANCE_PREWARM_HEADER = "x-attendance-prewarm-token";
export const ATTENDANCE_PREWARM_PATH = "/api/internal/attendance/prewarm";

const DEFAULT_ATTENDANCE_PREWARM_TIMEOUT_MS = 15_000;

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getAttendancePrewarmSecret() {
  const explicitSecret = process.env.ATTENDANCE_PREWARM_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  const authSecret =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || "";
  return authSecret || null;
}

export function getAttendancePrewarmTargets() {
  const rawTargets = process.env.ATTENDANCE_PREWARM_TARGETS ?? "";
  return Array.from(
    new Set(
      rawTargets
        .split(",")
        .map((value) => normalizeBaseUrl(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function getAttendancePrewarmTimeoutMs() {
  const parsed = Number(process.env.ATTENDANCE_PREWARM_TIMEOUT_MS ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ATTENDANCE_PREWARM_TIMEOUT_MS;
  }

  return Math.max(1_000, Math.trunc(parsed));
}

export async function prewarmAttendanceSessionLocally(sessionId: string) {
  return prewarmAttendanceMarkingSession(sessionId);
}

async function runAttendancePrewarmTarget(input: {
  target: string;
  sessionId: string;
  secret: string;
  timeoutMs: number;
}) {
  const response = await fetch(`${input.target}${ATTENDANCE_PREWARM_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [ATTENDANCE_PREWARM_HEADER]: input.secret,
    },
    body: JSON.stringify({ sessionId: input.sessionId }),
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Prewarm target ${input.target} returned ${response.status}${
        details ? `: ${details.slice(0, 200)}` : ""
      }`
    );
  }
}

export async function triggerAttendanceSessionClusterPrewarm(sessionId: string) {
  const targets = getAttendancePrewarmTargets();
  if (targets.length === 0) {
    const warmed = await prewarmAttendanceSessionLocally(sessionId);
    return {
      mode: "local" as const,
      targets: [] as string[],
      failedTargets: [] as string[],
      warmed,
    };
  }

  const secret = getAttendancePrewarmSecret();
  if (!secret) {
    const warmed = await prewarmAttendanceSessionLocally(sessionId);
    return {
      mode: "local-fallback" as const,
      targets,
      failedTargets: targets,
      warmed,
    };
  }

  const timeoutMs = getAttendancePrewarmTimeoutMs();
  const results = await Promise.allSettled(
    targets.map((target) =>
      runAttendancePrewarmTarget({
        target,
        sessionId,
        secret,
        timeoutMs,
      })
    )
  );

  const failedTargets = results
    .map((result, index) => ({ result, target: targets[index] }))
    .filter(
      (entry): entry is { result: PromiseRejectedResult; target: string } =>
        entry.result.status === "rejected"
    )
    .map((entry) => entry.target);

  return {
    mode: "cluster" as const,
    targets,
    failedTargets,
    warmed: failedTargets.length === targets.length
      ? null
      : {
          sessionId,
        },
  };
}
