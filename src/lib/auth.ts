import { createHash } from "node:crypto";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./passwords";
import {
  CACHE_KEYS,
  SharedRedisRequiredError,
  checkRateLimitKey,
  resetRateLimitKey,
} from "./cache";

const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
const LOGIN_EMAIL_MAX_ATTEMPTS = 8;
const LOGIN_IP_MAX_ATTEMPTS = 20;
const LOGIN_WINDOW_SECONDS = 15 * 60;

if (process.env.NODE_ENV === "production" && !authSecret) {
  throw new Error("AUTH_SECRET or NEXTAUTH_SECRET is required in production");
}

class LoginRateLimitError extends CredentialsSignin {
  code = "login_rate_limited";
}

class LoginUnavailableError extends CredentialsSignin {
  code = "login_unavailable";
}

function hashLoginRateLimitValue(value: string) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 32);
}

export function getClientIpAddress(request: Request) {
  const vercelIp = request.headers.get("x-vercel-forwarded-for");
  if (vercelIp) return vercelIp.split(",")[0].trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim().length > 0) return cfIp.trim();

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",");
    return ips[ips.length - 1].trim() || "unknown";
  }

  return "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null;
        const normalizedEmail = String(credentials.email).trim().toLowerCase();
        const clientIp = getClientIpAddress(request);
        const emailRateLimitKey = CACHE_KEYS.LOGIN_RATE_LIMIT(
          `email:${hashLoginRateLimitValue(normalizedEmail)}`
        );
        const ipRateLimitKey = CACHE_KEYS.LOGIN_RATE_LIMIT(
          `ip:${hashLoginRateLimitValue(clientIp)}`
        );

        try {
          const [emailLimit, ipLimit] = await Promise.all([
            checkRateLimitKey(
              emailRateLimitKey,
              LOGIN_EMAIL_MAX_ATTEMPTS,
              LOGIN_WINDOW_SECONDS
            ),
            checkRateLimitKey(
              ipRateLimitKey,
              LOGIN_IP_MAX_ATTEMPTS,
              LOGIN_WINDOW_SECONDS
            ),
          ]);

          if (!emailLimit.allowed || !ipLimit.allowed) {
            throw new LoginRateLimitError();
          }
        } catch (error) {
          if (error instanceof LoginRateLimitError) {
            throw error;
          }
          if (error instanceof SharedRedisRequiredError) {
            throw new LoginUnavailableError();
          }
          throw error;
        }

        const user = await db.user.findUnique({
          where: { email: normalizedEmail },
          include: { organization: true },
        });

        if (!user) return null;

        const passwordCheck = await verifyPassword(
          credentials.password as string,
          user.passwordHash
        );
        if (!passwordCheck.valid) return null;

        if (passwordCheck.needsRehash) {
          try {
            const upgradedHash = await hashPassword(credentials.password as string);
            await db.user.update({
              where: { id: user.id },
              data: { passwordHash: upgradedHash },
            });
          } catch (error) {
            console.warn("[auth] password hash upgrade failed:", error);
          }
        }

        await Promise.all([
          resetRateLimitKey(emailRateLimitKey),
        ]);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
          image: user.image,
          passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as any).role;
        token.organizationId = ((user as any).organizationId ?? null) as string | null;
        token.image = ((user as any).image ?? null) as string | null;
        token.passwordChangedAt = ((user as any).passwordChangedAt ?? null) as string | null;
      }

      if (token.sub) {
        const dbUser = await db.user.findUnique({
          where: { id: token.sub },
          select: {
            role: true,
            organizationId: true,
            image: true,
            passwordChangedAt: true,
          },
        });

        if (!dbUser) {
          return { ...token, invalid: true };
        }

        const dbTime = dbUser.passwordChangedAt?.getTime();
        const tokenTime = token.passwordChangedAt ? new Date(token.passwordChangedAt as string).getTime() : null;

        if (dbTime && (!tokenTime || tokenTime < dbTime)) {
          return { ...token, invalid: true };
        }

        token.id = token.sub;
        token.role = dbUser.role;
        token.organizationId = dbUser.organizationId;
        token.image = dbUser.image;
        token.passwordChangedAt = dbUser.passwordChangedAt?.toISOString() ?? null;
      }

      return token;
    },
    async session({ session, token }) {
      if (token.invalid || !token.id) {
        session.user = null as any;
        return session;
      }

      if (session.user) {
        const resolvedId = (token.id as string | undefined) ?? token.sub;
        session.user.id = resolvedId as string;
        session.user.role = token.role as any;
        session.user.organizationId = (token.organizationId as string | null) ?? null;
        session.user.image = (token.image as string | null | undefined) ?? null;
      }
      return session;
    },
  },
});
