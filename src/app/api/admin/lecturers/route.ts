import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdminLike, resolveOrganizationIdForStaff } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!isAdminLike(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedOrgId = new URL(request.url).searchParams.get("organizationId");
  const organizationId = resolveOrganizationIdForStaff(user, requestedOrgId);
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const lecturers = await db.user.findMany({
    where: {
      organizationId,
      role: "LECTURER",
    },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      courses: {
        select: {
          id: true,
          code: true,
          name: true,
        },
        orderBy: { code: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ lecturers });
}

