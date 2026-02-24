import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * List students in the current user's organization.
 * Used by Admin and Lecturer when adding students to courses.
 */
export async function GET() {
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

  const students = await db.user.findMany({
    where: { organizationId: orgId, role: "STUDENT" },
    select: {
      id: true,
      name: true,
      email: true,
      studentId: true,
      indexNumber: true,
    },
    orderBy: [{ name: "asc" }],
  });

  return NextResponse.json(students);
}
