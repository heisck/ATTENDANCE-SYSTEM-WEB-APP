import { db } from "./db";
import { cacheGet, cacheSet, cacheDel, CACHE_KEYS, CACHE_TTL } from "./cache";

/**
 * Device fingerprinting for spoofing detection
 * Combines multiple device signals into a unique identifier
 */
export interface DeviceFingerprint {
  userAgent: string;
  platform: string;
  osVersion?: string;
  screenResolution: string;
  timezone: string;
  language: string;
}

export function generateDeviceFingerprint(
  userAgent: string,
  platform: string,
  osVersion?: string
): DeviceFingerprint {
  // Get screen resolution
  let screenResolution = "unknown";
  if (typeof window !== "undefined") {
    screenResolution = `${window.screen.width}x${window.screen.height}`;
  }

  // Get timezone
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Get language
  const language = navigator.language || "en-US";

  return {
    userAgent,
    platform,
    osVersion,
    screenResolution,
    timezone,
    language,
  };
}

/**
 * Generate a deterministic hash of device fingerprint
 */
export function hashDeviceFingerprint(fingerprint: DeviceFingerprint): string {
  const crypto = require("crypto");
  const combined = JSON.stringify(fingerprint);
  return crypto.createHash("sha256").update(combined).digest("hex");
}

/**
 * Register or retrieve a device for a user
 */
export async function linkDevice(
  userId: string,
  deviceToken: string,
  deviceInfo: {
    deviceName: string;
    deviceType: "iOS" | "Android" | "Web";
    osVersion?: string;
    appVersion?: string;
    fingerprint?: string;
    bleSignature?: string;
  }
): Promise<{ id: string; isNewDevice: boolean; trustedAt: Date | null }> {
  try {
    // Check if device already exists
    const existing = await db.userDevice.findFirst({
      where: {
        userId,
        deviceToken,
        revokedAt: null,
      },
      select: {
        id: true,
        trustedAt: true,
      },
    });

    if (existing) {
      // Update last used timestamp
      await db.userDevice.update({
        where: { id: existing.id },
        data: {
          lastUsedAt: new Date(),
          bleSignature: deviceInfo.bleSignature,
        },
      });

      return {
        id: existing.id,
        isNewDevice: false,
        trustedAt: existing.trustedAt,
      };
    }

    // Create new device registration
    const newDevice = await db.userDevice.create({
      data: {
        userId,
        deviceToken,
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType,
        osVersion: deviceInfo.osVersion,
        appVersion: deviceInfo.appVersion,
        fingerprint: deviceInfo.fingerprint,
        bleSignature: deviceInfo.bleSignature,
        lastUsedAt: new Date(),
      },
      select: {
        id: true,
        trustedAt: true,
      },
    });

    // Invalidate user credentials cache
    await cacheDel(CACHE_KEYS.USER_CREDENTIALS(userId));

    return {
      id: newDevice.id,
      isNewDevice: true,
      trustedAt: newDevice.trustedAt,
    };
  } catch (error) {
    console.error("[v0] Link device error:", error);
    throw error;
  }
}

/**
 * Get or compute device consistency score
 * Compares current device with historical devices used by this student
 */
export async function getDeviceConsistencyScore(
  studentId: string,
  currentDeviceToken: string
): Promise<number> {
  try {
    const cacheKey = CACHE_KEYS.DEVICE_FINGERPRINT(studentId, currentDeviceToken);

    // Check cache first
    const cached = await cacheGet<number>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Get all devices used by this student in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentDevices = await db.userDevice.findMany({
      where: {
        userId: studentId,
        revokedAt: null,
        lastUsedAt: { gte: thirtyDaysAgo },
      },
      select: {
        deviceToken: true,
        trustedAt: true,
      },
    });

    if (recentDevices.length === 0) {
      const score = 100; // New student, assume legitimate
      await cacheSet(cacheKey, score, CACHE_TTL.DEVICE_FINGERPRINT);
      return score;
    }

    // Score calculation:
    // - Exact device match: 100
    // - Trusted device: 90
    // - New device (first use): 70
    // - Multiple different devices per day: lower score

    let score = 50; // Start low for security

    if (recentDevices.some((d) => d.deviceToken === currentDeviceToken)) {
      score = 100; // Familiar device
    } else if (recentDevices.length <= 2) {
      score = 80; // Student uses limited device set
    } else if (recentDevices.length <= 5) {
      score = 60; // Student uses multiple devices
    } else {
      score = 40; // Many different devices (suspicious pattern)
    }

    // Bonus if using trusted device
    const trustedDevices = recentDevices.filter((d) => d.trustedAt);
    if (trustedDevices.length > 0 && score < 85) {
      score += 15;
    }

    // Cache the result
    await cacheSet(cacheKey, score, CACHE_TTL.DEVICE_FINGERPRINT);

    return Math.min(100, score);
  } catch (error) {
    console.error("[v0] Device consistency check error:", error);
    return 50; // Default to medium score on error
  }
}

/**
 * Check if device is trusted (manually verified by admin)
 */
export async function isDeviceTrusted(
  userId: string,
  deviceToken: string
): Promise<boolean> {
  try {
    const device = await db.userDevice.findFirst({
      where: {
        userId,
        deviceToken,
        revokedAt: null,
      },
      select: {
        trustedAt: true,
      },
    });

    return device?.trustedAt !== null && device?.trustedAt !== undefined;
  } catch (error) {
    console.error("[v0] Device trust check error:", error);
    return false;
  }
}

/**
 * Revoke a device (prevent further attendance)
 */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  try {
    await db.userDevice.update({
      where: {
        id: deviceId,
        userId, // Ensure user owns this device
      },
      data: {
        revokedAt: new Date(),
      },
    });

    // Invalidate caches
    await cacheDel(CACHE_KEYS.USER_CREDENTIALS(userId));

    return true;
  } catch (error) {
    console.error("[v0] Revoke device error:", error);
    return false;
  }
}

/**
 * Trust/verify a device (admin action)
 */
export async function trustDevice(userId: string, deviceId: string): Promise<boolean> {
  try {
    await db.userDevice.update({
      where: {
        id: deviceId,
        userId,
      },
      data: {
        trustedAt: new Date(),
      },
    });

    return true;
  } catch (error) {
    console.error("[v0] Trust device error:", error);
    return false;
  }
}

/**
 * Get all devices for a user
 */
export async function getUserDevices(userId: string) {
  try {
    return await db.userDevice.findMany({
      where: { userId },
      select: {
        id: true,
        deviceName: true,
        deviceType: true,
        osVersion: true,
        lastUsedAt: true,
        trustedAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { lastUsedAt: "desc" },
    });
  } catch (error) {
    console.error("[v0] Get user devices error:", error);
    return [];
  }
}

/**
 * Clean up revoked devices older than 90 days
 */
export async function cleanupRevokedDevices(): Promise<number> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const result = await db.userDevice.deleteMany({
      where: {
        revokedAt: { lt: ninetyDaysAgo },
      },
    });

    return result.count;
  } catch (error) {
    console.error("[v0] Cleanup revoked devices error:", error);
    return 0;
  }
}
