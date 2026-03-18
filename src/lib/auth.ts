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

class LoginRateLimitError extends CredentialsSignin {
  code = "login_rate_limited";
}

class LoginUnavailableError extends CredentialsSignin {
  code = "login_unavailable";
}

function hashLoginRateLimitValue(value: string) {
  return createHash("sha256").update(value).digest("base64url").slice(0, 32);
}

function getClientIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [first] = forwardedFor.split(",");
    if (first && first.trim().length > 0) {
      return first.trim();
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) {
    return realIp.trim();
  }

  const connectingIp = request.headers.get("cf-connecting-ip");
  if (connectingIp && connectingIp.trim().length > 0) {
    return connectingIp.trim();
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
          resetRateLimitKey(ipRateLimitKey),
        ]);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
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
      }

      // Self-heal older/incomplete JWT payloads by hydrating role/org from DB.
      if ((!token.role || !token.id) && token.sub) {
        const dbUser = await db.user.findUnique({
          where: { id: token.sub },
          select: {
            role: true,
            organizationId: true,
          },
        });

        if (dbUser) {
          token.id = token.sub;
          token.role = dbUser.role;
          token.organizationId = dbUser.organizationId;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const resolvedId = (token.id as string | undefined) ?? token.sub;
        session.user.id = resolvedId as string;
        session.user.role = token.role as any;
        session.user.organizationId = (token.organizationId as string | null) ?? null;
      }
      return session;
    },
  },
});
