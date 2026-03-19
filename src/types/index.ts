import { AttendancePhase, Role, SessionStatus } from "@prisma/client";
import type { DefaultSession } from "next-auth";

export type { AttendancePhase, Role, SessionStatus };

/**
 * Extended User type for sessions and JWT tokens.
 * Includes all custom fields beyond the defaults.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  image?: string | null;
}

/**
 * NextAuth JWT Token augmentation.
 * Extends the default JWT with custom fields.
 */
declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    organizationId: string | null;
    image?: string | null;
  }
}

/**
 * NextAuth Session augmentation.
 * Extends the default session.user with custom fields.
 */
declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: Role;
      organizationId: string | null;
      image?: string | null;
    };
  }

  interface User {
    role: Role;
    organizationId: string | null;
    image?: string | null;
  }
}

export interface OrganizationSettings {
  confidenceThreshold: number;
}

export interface QRPayload {
  sessionId: string;
  token: string;
  ts: number;
  seq: number;
  phase: AttendancePhase;
}

export interface AttendanceVerification {
  webauthnVerified: boolean;
  qrTokenValid: boolean;
  bleProximityVerified?: boolean;
  confidence: number;
  flagged: boolean;
}
