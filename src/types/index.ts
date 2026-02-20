import { AttendancePhase, Role, SessionStatus } from "@prisma/client";

export type { AttendancePhase, Role, SessionStatus };

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

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
}
