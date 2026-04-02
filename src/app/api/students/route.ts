import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * List students in the current user's organization.
 * Used by Admin and Lecturer when adding students to courses.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { organizationId?: string | null; role: string };
  const orgId = user.organizationId;

  if (!orgId) {
    return NextResponse.json({ error: "Organization required" }, { status: 403 });
  }

  if (!["ADMIN", "SUPER_ADMIN", "LECTURER"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const q = searchParams.get("q") || "";
  const take = Math.min(Math.max(1, parseInt(searchParams.get("take") || "1000", 10)), 5000);
  const skip = Math.max(0, parseInt(searchParams.get("skip") || "0", 10));

  const whereClause: any = { organizationId: orgId, role: "STUDENT" };
  if (q.trim()) {
    whereClause.OR = [
      { name: { contains: q.trim(), mode: "insensitive" } },
      { email: { contains: q.trim(), mode: "insensitive" } },
      { studentId: { contains: q.trim(), mode: "insensitive" } },
    ];
  }

  const students = await db.user.findMany({
    where: whereClause,
    take,
    skip,
    select: {
      id: true,
      name: true,
      email: true,
      studentId: true,
      indexNumber: true,
      cohort: {
        select: {
          id: true,
          department: true,
          level: true,
          groupCode: true,
          displayName: true,
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return NextResponse.json(students);
}
