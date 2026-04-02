import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cacheHealthCheck } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  const checks: Record<string, { status: string; latencyMs?: number }> = {};

  // Database check
  try {
    const dbStart = Date.now();
    await db.$queryRaw`SELECT 1`;
    checks.database = { status: "healthy", latencyMs: Date.now() - dbStart };
  } catch {
    checks.database = { status: "unhealthy" };
  }

  // Cache/Redis check
  try {
    const cacheStart = Date.now();
    const cacheOk = await cacheHealthCheck();
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

  return NextResponse.json(
    {
      status: allHealthy ? "healthy" : "unhealthy",
      uptime: process.uptime(),
      latencyMs: Date.now() - start,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: allHealthy ? 200 : 503 }
  );
}
