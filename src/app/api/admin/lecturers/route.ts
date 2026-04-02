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

  const searchParams = new URL(request.url).searchParams;
  const q = searchParams.get("q") || "";
  const take = Math.min(Math.max(1, parseInt(searchParams.get("take") || "500", 10)), 2000);
  const skip = Math.max(0, parseInt(searchParams.get("skip") || "0", 10));

  const whereClause: any = { organizationId, role: "LECTURER" };
  if (q.trim()) {
    whereClause.OR = [
      { name: { contains: q.trim(), mode: "insensitive" } },
      { email: { contains: q.trim(), mode: "insensitive" } },
    ];
  }

  const lecturers = await db.user.findMany({
    where: whereClause,
    take,
    skip,
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

