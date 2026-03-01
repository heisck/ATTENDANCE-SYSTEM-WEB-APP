import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const orgId = user.organizationId;
    if (!orgId) {
      return NextResponse.json({ error: "No organization found" }, { status: 400 });
    }

    const users = await db.user.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        studentId: true,
        indexNumber: true,
        createdAt: true,
        passkeysLockedUntilAdminReset: true,
        firstPasskeyCreatedAt: true,
        cohort: {
          select: {
            id: true,
            displayName: true,
            level: true,
          },
        },
        _count: { select: { credentials: true, attendances: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        studentId: u.studentId,
        indexNumber: u.indexNumber,
        joinedAt: u.createdAt,
        passkeysLockedUntilAdminReset: u.passkeysLockedUntilAdminReset,
        firstPasskeyCreatedAt: u.firstPasskeyCreatedAt,
        credentialCount: u._count.credentials,
        attendanceCount: u._count.attendances,
        deviceRegistered: u._count.credentials > 0,
        classGroup: u.cohort
          ? {
              id: u.cohort.id,
              displayName: u.cohort.displayName,
              level: u.cohort.level,
            }
          : null,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
