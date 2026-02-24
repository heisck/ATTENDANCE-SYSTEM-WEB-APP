import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";

const roleDashboard: Record<string, string> = {
  STUDENT: "/student",
  LECTURER: "/lecturer",
  ADMIN: "/admin",
  SUPER_ADMIN: "/super-admin",
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  let role = user.role as string | undefined;

  // Fallback for legacy/incomplete session payloads.
  if (!role) {
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });
    role = dbUser?.role;
  }

  if (!role) {
    return NextResponse.json(
      { error: "Session role is missing" },
      { status: 409 }
    );
  }

  if (role === "STUDENT") {
    const gate = await getStudentGateState(user.id);
    return NextResponse.json({
      role,
      redirectTo: gate.redirectPath ?? "/student",
    });
  }

  return NextResponse.json({
    role,
    redirectTo: roleDashboard[role] ?? "/student",
  });
}
