import { AttendancePhase, Role, SessionStatus } from "@prisma/client";
import type { DefaultSession, JWT } from "next-auth";

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
    };
  }

  interface User {
    role: Role;
    organizationId: string | null;
  }
}

export interface OrganizationSettings {
  campusLat: number;
  campusLng: number;
  defaultRadiusMeters: number;
  confidenceThreshold: number;
}

export interface QRPayload {
  sessionId: string;
  token: string;
  ts: number;
  seq: number;
  phase: AttendancePhase;
}

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface AttendanceVerification {
  webauthnVerified: boolean;
  gpsWithinRadius: boolean;
  gpsDistance: number;
  qrTokenValid: boolean;
  ipTrusted: boolean;
  confidence: number;
  flagged: boolean;
}
