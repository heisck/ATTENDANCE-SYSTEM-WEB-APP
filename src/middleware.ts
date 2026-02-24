import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const roleRoutes: Record<string, string[]> = {
  STUDENT: ["/student"],
  LECTURER: ["/lecturer"],
  ADMIN: ["/admin"],
  SUPER_ADMIN: ["/super-admin", "/admin"],
};

const roleDashboard: Record<string, string> = {
  STUDENT: "/student",
  LECTURER: "/lecturer",
  ADMIN: "/admin",
  SUPER_ADMIN: "/super-admin",
};

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
    secureCookie: req.nextUrl.protocol === "https:",
  });
  const rawRole = typeof (token as any)?.role === "string" ? (token as any).role : "";
  const hasKnownRole = rawRole in roleRoutes;
  const resolvedId =
    typeof (token as any)?.id === "string" && (token as any).id.length > 0
      ? (token as any).id
      : typeof (token as any)?.sub === "string"
        ? (token as any).sub
        : "";

  const user =
    token && resolvedId && hasKnownRole
      ? {
          id: resolvedId,
          role: rawRole,
          organizationId: ((token as any).organizationId ?? null) as string | null,
        }
      : null;

  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/register");
  const isDashboard =
    pathname.startsWith("/student") ||
    pathname.startsWith("/lecturer") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/super-admin");
  const isSetupDevice = pathname.startsWith("/setup-device");

  if (isAuthPage && user) {
    const dashboard = roleDashboard[user.role] || "/student";
    return NextResponse.redirect(new URL(dashboard, req.url));
  }

  if ((isDashboard || isSetupDevice) && !user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isDashboard && user) {
    const role = user.role as string;
    const allowed = roleRoutes[role] || [];
    const hasAccess = allowed.some((route) => pathname.startsWith(route));

    if (!hasAccess) {
      const dashboard = roleDashboard[role] || "/student";
      return NextResponse.redirect(new URL(dashboard, req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/student/:path*",
    "/lecturer/:path*",
    "/admin/:path*",
    "/super-admin/:path*",
    "/login",
    "/register",
    "/setup-device",
  ],
};
