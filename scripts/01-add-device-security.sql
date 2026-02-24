-- Migration: Add device linking and security enhancements
-- This migration adds tables for multi-device support and anomaly detection

-- UserDevice table for device linking
CREATE TABLE IF NOT EXISTS "UserDevice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "deviceToken" TEXT NOT NULL UNIQUE,
  "deviceName" TEXT NOT NULL,
  "deviceType" TEXT NOT NULL,
  "osVersion" TEXT,
  "appVersion" TEXT,
  "bleSignature" TEXT,
  "bleLastSeen" TIMESTAMP(3),
  "fingerprint" TEXT,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trustedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserDevice_userId_idx" ON "UserDevice"("userId");
CREATE INDEX IF NOT EXISTS "UserDevice_deviceToken_idx" ON "UserDevice"("deviceToken");
CREATE INDEX IF NOT EXISTS "UserDevice_revokedAt_idx" ON "UserDevice"("revokedAt");
CREATE INDEX IF NOT EXISTS "UserDevice_bleSignature_idx" ON "UserDevice"("bleSignature");

-- AttendanceAnomaly table for security monitoring
CREATE TABLE IF NOT EXISTS "AttendanceAnomaly" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "sessionId" TEXT,
  "anomalyType" TEXT NOT NULL,
  "severity" INTEGER NOT NULL DEFAULT 50,
  "confidence" REAL NOT NULL DEFAULT 0.5,
  "details" JSONB NOT NULL DEFAULT '{}',
  "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "action" TEXT,
  "actionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceAnomaly_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AttendanceAnomaly_studentId_idx" ON "AttendanceAnomaly"("studentId");
CREATE INDEX IF NOT EXISTS "AttendanceAnomaly_sessionId_idx" ON "AttendanceAnomaly"("sessionId");
CREATE INDEX IF NOT EXISTS "AttendanceAnomaly_anomalyType_idx" ON "AttendanceAnomaly"("anomalyType");
CREATE INDEX IF NOT EXISTS "AttendanceAnomaly_severity_idx" ON "AttendanceAnomaly"("severity");
CREATE INDEX IF NOT EXISTS "AttendanceAnomaly_reviewedAt_idx" ON "AttendanceAnomaly"("reviewedAt");
CREATE INDEX IF NOT EXISTS "AttendanceAnomaly_flaggedAt_idx" ON "AttendanceAnomaly"("flaggedAt");

-- SessionMonitoring table for real-time admin dashboard
CREATE TABLE IF NOT EXISTS "SessionMonitoring" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL UNIQUE,
  "totalEnrolled" INTEGER NOT NULL DEFAULT 0,
  "totalAttempted" INTEGER NOT NULL DEFAULT 0,
  "totalVerified" INTEGER NOT NULL DEFAULT 0,
  "flaggedCount" INTEGER NOT NULL DEFAULT 0,
  "anomalyCount" INTEGER NOT NULL DEFAULT 0,
  "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "estimatedCompletion" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "SessionMonitoring_sessionId_idx" ON "SessionMonitoring"("sessionId");

-- BleDeviceSignature table for BLE proximity verification
CREATE TABLE IF NOT EXISTS "BleDeviceSignature" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userDeviceId" TEXT NOT NULL UNIQUE,
  "bleAddress" TEXT NOT NULL,
  "bleUuid" TEXT,
  "txPower" INTEGER,
  "lastVerified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verificationCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BleDeviceSignature_userDeviceId_fkey" FOREIGN KEY ("userDeviceId") REFERENCES "UserDevice" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "BleDeviceSignature_bleAddress_idx" ON "BleDeviceSignature"("bleAddress");
CREATE INDEX IF NOT EXISTS "BleDeviceSignature_userDeviceId_idx" ON "BleDeviceSignature"("userDeviceId");

-- Add columns to AttendanceRecord for enhanced security
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "deviceToken" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "bleSignalStrength" INTEGER;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "deviceConsistency" REAL;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "gpsVelocity" REAL;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "anomalyScore" REAL;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS "AttendanceRecord_anomalyScore_idx" ON "AttendanceRecord"("anomalyScore");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_deviceToken_idx" ON "AttendanceRecord"("deviceToken");
