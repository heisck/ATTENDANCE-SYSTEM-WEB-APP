import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cacheHealthCheck } from "@/lib/cache";

export const dynamic = "force-dynamic";

// Cache health result for 3 seconds — prevents DB/Redis bombardment from
// load balancer probes while keeping staleness minimal.
let cachedResult: { payload: Record<string, unknown>; status: number; expiresAt: number } | null = null;

export async function GET() {
  const now = Date.now();
  if (cachedResult && cachedResult.expiresAt > now) {
    return NextResponse.json(cachedResult.payload, {
      status: cachedResult.status,
      headers: { "Cache-Control": "no-cache, max-age=3" },
    });
  }

  const start = now;
  const checks: Record<string, { status: string; latencyMs?: number }> = {};

  const HEALTH_CHECK_TIMEOUT = 3_000;
  const timeout = (ms: number) =>
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    );

  // Database check
  try {
    const dbStart = Date.now();
    await Promise.race([db.$queryRaw`SELECT 1`, timeout(HEALTH_CHECK_TIMEOUT)]);
    checks.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch {
    checks.database = { status: "unhealthy" };
  }

  // Cache/Redis check
  try {
    const cacheStart = Date.now();
    const cacheOk = await Promise.race([cacheHealthCheck(), timeout(HEALTH_CHECK_TIMEOUT)]);
    checks.cache = {
      status: cacheOk ? "healthy" : "degraded",
      latencyMs: Date.now() - cacheStart,
    };
  } catch {
    checks.cache = { status: "unhealthy" };
  }

  const allHealthy = Object.values(checks).every(
    (c) => c.status === "healthy" || c.status === "degraded"
  );

  const payload = {
    status: allHealthy ? "healthy" : "unhealthy",
    uptime: process.uptime(),
    latencyMs: Date.now() - start,
    checks,
    timestamp: new Date().toISOString(),
  };
  const status = allHealthy ? 200 : 503;

  cachedResult = { payload, status, expiresAt: now + 3_000 };

  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-cache, max-age=3" },
  });
}
