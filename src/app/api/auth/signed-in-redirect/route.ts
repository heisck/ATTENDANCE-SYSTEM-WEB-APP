import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentGateState } from "@/lib/student-gates";

const roleDashboard: Record<string, string> = {
  STUDENT: "/student",
  LECTURER: "/lecturer",
  ADMIN: "/admin",
  SUPER_ADMIN: "/super-admin",
};

/**
 * Server-side redirect after sign-in. Used as callbackUrl for signIn(redirect: true).
 * Ensures the session cookie is set in the same response chain before redirecting,
 * fixing cookie propagation issues on Vercel/serverless.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const user = session.user as { id: string; role?: string };
  let role = user.role;

  if (!role) {
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });
    role = dbUser?.role ?? undefined;
  }

  if (!role) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  let target: string;
  if (role === "STUDENT") {
    const gate = await getStudentGateState(user.id);
    target = gate.redirectPath ?? "/student";
  } else {
    target = roleDashboard[role] ?? "/student";
  }

  return NextResponse.redirect(new URL(target, request.url));
}
