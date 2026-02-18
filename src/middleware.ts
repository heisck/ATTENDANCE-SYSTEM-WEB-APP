import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

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

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user as any;

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
});

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
