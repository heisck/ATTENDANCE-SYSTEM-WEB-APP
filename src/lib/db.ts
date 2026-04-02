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

export const db =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: {
      db: {
        url: buildDatabaseUrl(),
      },
    },
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
