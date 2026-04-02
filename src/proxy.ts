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

function buildContentSecurityPolicy(nonce: string) {
  const isDevelopment = process.env.NODE_ENV === "development";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "font-src 'self'",
    `connect-src 'self' https://*.amazonaws.com https://*.cloudinary.com ${isDevelopment ? "ws: wss:" : "wss:"}`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://*.amazonaws.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function withSecurityHeaders(response: NextResponse, csp: string) {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(req.headers);

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

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

  // --- API auth guard: reject unauthenticated requests to protected API routes ---
  if (pathname.startsWith("/api/")) {
    // Public API routes bypass session-based auth.
    // /api/auth — NextAuth endpoints (login, register, etc.)
    // /api/public — explicitly public routes
    // /api/v1/attendance — external API (validates its own API key)
    // /api/internal/attendance/prewarm — server-to-server (validates its own secret)
    // /api/face/enrollment/public — public face enrollment check
    // /api/health — load balancer health probes
    const isPublicApi =
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/public") ||
      pathname.startsWith("/api/v1/attendance") ||
      pathname.startsWith("/api/internal/attendance/prewarm") ||
      pathname.startsWith("/api/face/enrollment/public") ||
      pathname.startsWith("/api/health");

    if (!isPublicApi && !user) {
      return withSecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        contentSecurityPolicy
      );
    }

    return withSecurityHeaders(
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }),
      contentSecurityPolicy
    );
  }

  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/register");
  const isDashboard =
    pathname.startsWith("/student") ||
    pathname.startsWith("/lecturer") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/super-admin");
  const isSetupDevice = pathname.startsWith("/setup-device");

  if (isAuthPage && user) {
    const dashboard = roleDashboard[user.role] || "/student";
    return withSecurityHeaders(
      NextResponse.redirect(new URL(dashboard, req.url)),
      contentSecurityPolicy
    );
  }

  if ((isDashboard || isSetupDevice) && !user) {
    return withSecurityHeaders(
      NextResponse.redirect(new URL("/login", req.url)),
      contentSecurityPolicy
    );
  }

  if (isDashboard && user) {
    const role = user.role as string;
    const allowed = roleRoutes[role] || [];
    const hasAccess = allowed.some((route) => pathname.startsWith(route));

    if (!hasAccess) {
      const dashboard = roleDashboard[role] || "/student";
      return withSecurityHeaders(
        NextResponse.redirect(new URL(dashboard, req.url)),
        contentSecurityPolicy
      );
    }
  }

  return withSecurityHeaders(
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
    contentSecurityPolicy
  );
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
