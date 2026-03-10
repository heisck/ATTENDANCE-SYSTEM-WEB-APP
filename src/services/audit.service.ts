import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export async function createAuditLog(
  userId: string,
  action: string,
  metadata: Record<string, unknown>,
  ipAddress?: string | null
) {
  const metadataWithIp =
    typeof ipAddress === "string" && ipAddress.trim().length > 0
      ? { ...metadata, ipAddress: ipAddress.trim() }
      : metadata;

  return db.auditLog.create({
    data: { userId, action, metadata: metadataWithIp as Prisma.InputJsonValue },
  });
}

export async function getAuditLogs(
  organizationId: string,
  options: { page?: number; limit?: number; action?: string } = {}
) {
  const { page = 1, limit = 50, action } = options;

  const where: any = {
    user: { organizationId },
  };
  if (action) where.action = action;

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.auditLog.count({ where }),
  ]);

  return { logs, total, pages: Math.ceil(total / limit) };
}
