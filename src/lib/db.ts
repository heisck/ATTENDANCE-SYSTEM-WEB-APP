import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function buildDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;

  // Append connection pool params if not already present
  const separator = url.includes("?") ? "&" : "?";
  const hasPoolParams = url.includes("connection_limit") || url.includes("pool_timeout");
  if (hasPoolParams) return url;

  return `${url}${separator}connection_limit=50&pool_timeout=30`;
}

const dbUrl = buildDatabaseUrl();

export const db =
  globalForPrisma.prisma ||
  new PrismaClient({
    ...(dbUrl ? { datasources: { db: { url: dbUrl } } } : {}),
    log: [],
  });

// Cache the Prisma instance globally to prevent connection pool exhaustion
// across hot-module reloads (dev) and serverless function re-invocations (prod)
if (!globalForPrisma.prisma) globalForPrisma.prisma = db;
