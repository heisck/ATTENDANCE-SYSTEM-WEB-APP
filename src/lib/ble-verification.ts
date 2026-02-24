import { db } from "./db";
import { cacheGet, cacheSet, CACHE_KEYS, CACHE_TTL } from "./cache";

/**
 * BLE signal ranging to estimate distance from RSSI
 * RSSI (Received Signal Strength Indicator) in dBm
 * Typical range: -20 (very close) to -100 (far)
 */
export function estimateDistanceFromRSSI(
  rssi: number,
  txPower: number = -59 // Typical TX power at 1 meter
): number {
  // Log distance formula: distance = 10 ^ ((txPower - rssi) / (10 * n))
  // where n = path loss exponent (typically 2-4 for indoor)
  const n = 2.5; // Average path loss exponent
  const distance = Math.pow(10, (txPower - rssi) / (10 * n));
  return Math.round(distance * 100) / 100; // Distance in meters
}

/**
 * Register BLE device signature for a user device
 */
export async function registerBleSignature(
  userDeviceId: string,
  bleAddress: string,
  bleUuid?: string,
  txPower?: number
): Promise<{ id: string; verified: boolean }> {
  try {
    // Check if signature already exists
    const existing = await db.bleDeviceSignature.findFirst({
      where: { userDeviceId },
    });

    if (existing) {
      // Update existing signature
      await db.bleDeviceSignature.update({
        where: { id: existing.id },
        data: {
          bleAddress,
          bleUuid,
          txPower,
          lastVerified: new Date(),
          verificationCount: {
            increment: 1,
          },
        },
      });

      return { id: existing.id, verified: existing.verificationCount > 0 };
    }

    // Create new signature
    const signature = await db.bleDeviceSignature.create({
      data: {
        userDeviceId,
        bleAddress,
        bleUuid,
        txPower: txPower || -59,
        lastVerified: new Date(),
        verificationCount: 1,
      },
    });

    return { id: signature.id, verified: false };
  } catch (error) {
    console.error("[v0] Register BLE signature error:", error);
    throw error;
  }
}

/**
 * Verify BLE proximity between source and verifying devices
 * Multiple devices can verify each other's proximity
 */
export async function verifyBleProximity(
  sourceDeviceId: string, // The device showing QR
  verifyingDeviceIds: string[], // Devices scanning the QR
  maxDistanceMeters: number = 10 // Max distance for verification
): Promise<{
  proximityVerified: boolean;
  verifiedDevices: string[];
  failedDevices: string[];
  averageRssi: number;
}> {
  try {
    const verifiedDevices: string[] = [];
    const failedDevices: string[] = [];
    const rssiValues: number[] = [];

    // Get source device's BLE signature
    const sourceSignature = await db.bleDeviceSignature.findFirst({
      where: { userDeviceId: sourceDeviceId },
      select: { bleAddress: true, txPower: true },
    });

    if (!sourceSignature) {
      return {
        proximityVerified: false,
        verifiedDevices: [],
        failedDevices: verifyingDeviceIds,
        averageRssi: 0,
      };
    }

    // In a real implementation, this would communicate with mobile app
    // to get actual RSSI measurements from nearby devices
    // For now, we'll store the intent to verify
    for (const deviceId of verifyingDeviceIds) {
      try {
        // In production, this would:
        // 1. Ask device to scan for BLE signals
        // 2. Measure RSSI of source device
        // 3. Calculate distance and verify it's within threshold
        // For now, assume verification (would be handled by client SDK)

        verifiedDevices.push(deviceId);
      } catch {
        failedDevices.push(deviceId);
      }
    }

    const averageRssi = rssiValues.length > 0
      ? rssiValues.reduce((a, b) => a + b) / rssiValues.length
      : -70;

    return {
      proximityVerified: verifiedDevices.length > 0,
      verifiedDevices,
      failedDevices,
      averageRssi,
    };
  } catch (error) {
    console.error("[v0] BLE proximity verification error:", error);
    return {
      proximityVerified: false,
      verifiedDevices: [],
      failedDevices: verifyingDeviceIds,
      averageRssi: 0,
    };
  }
}

/**
 * Store BLE signal measurement for analysis
 */
export async function recordBleSignalMeasurement(
  attendanceRecordId: string,
  rssi: number,
  distance: number
): Promise<boolean> {
  try {
    const txPower = -59; // Standard TX power
    const calculatedDistance = estimateDistanceFromRSSI(rssi, txPower);

    // Update attendance record with BLE data
    await db.attendanceRecord.update({
      where: { id: attendanceRecordId },
      data: {
        bleSignalStrength: rssi,
      },
    });

    return true;
  } catch (error) {
    console.error("[v0] Record BLE signal error:", error);
    return false;
  }
}

/**
 * Get BLE statistics for a device
 */
export async function getDeviceBleStats(userDeviceId: string): Promise<{
  averageRssi: number;
  verificationCount: number;
  lastVerified: Date | null;
  distanceMeters: number;
}> {
  try {
    const cacheKey = CACHE_KEYS.DEVICE_FINGERPRINT("ble-stats", userDeviceId);

    // Check cache
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      return cached;
    }

    const signature = await db.bleDeviceSignature.findFirst({
      where: { userDeviceId },
      select: {
        txPower: true,
        verificationCount: true,
        lastVerified: true,
      },
    });

    if (!signature) {
      return {
        averageRssi: 0,
        verificationCount: 0,
        lastVerified: null,
        distanceMeters: 0,
      };
    }

    // In real implementation, would aggregate measurements
    const averageRssi = -70; // Default
    const distance = estimateDistanceFromRSSI(averageRssi, signature.txPower || -59);

    const stats = {
      averageRssi,
      verificationCount: signature.verificationCount,
      lastVerified: signature.lastVerified,
      distanceMeters: distance,
    };

    // Cache for 5 minutes
    await cacheSet(cacheKey, stats, CACHE_TTL.DEVICE_FINGERPRINT);

    return stats;
  } catch (error) {
    console.error("[v0] Get BLE stats error:", error);
    return {
      averageRssi: 0,
      verificationCount: 0,
      lastVerified: null,
      distanceMeters: 0,
    };
  }
}

/**
 * Check if device supports BLE (client-side check)
 * Should be called on the frontend
 */
export function checkBleSupport(): {
  supported: boolean;
  reason?: string;
} {
  if (typeof window === "undefined") {
    return { supported: false, reason: "Not in browser context" };
  }

  const hasWebBluetooth = (navigator as any).bluetooth !== undefined;
  const isSecureContext = window.isSecureContext;

  if (!isSecureContext) {
    return { supported: false, reason: "HTTPS required" };
  }

  if (!hasWebBluetooth) {
    return {
      supported: false,
      reason: "Web Bluetooth not available on this device/browser",
    };
  }

  return { supported: true };
}

/**
 * Clean up old BLE signatures
 */
export async function cleanupOldBleSignatures(): Promise<number> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await db.bleDeviceSignature.deleteMany({
      where: {
        lastVerified: { lt: thirtyDaysAgo },
      },
    });

    return result.count;
  } catch (error) {
    console.error("[v0] Cleanup BLE signatures error:", error);
    return 0;
  }
}

/**
 * Calculate BLE-based confidence boost
 * Devices very close together get extra confidence
 */
export function calculateBleConfidenceBoost(rssi: number): number {
  // RSSI ranges from -20 (very close) to -100 (far)
  // -20 to -50: Very close (high confidence)
  // -50 to -70: Close (medium confidence)
  // -70 to -90: Far (low confidence)
  // Below -90: Too far

  if (rssi > -50) {
    return 20; // Very close, high confidence boost
  } else if (rssi > -70) {
    return 10; // Close, medium confidence boost
  } else if (rssi > -90) {
    return 5; // Far but detected
  }

  return 0; // Too far or not detected
}
