const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine formula: computes the great-circle distance in meters
 * between two GPS coordinates.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

export function isWithinRadius(
  studentLat: number,
  studentLng: number,
  sessionLat: number,
  sessionLng: number,
  radiusMeters: number
): { within: boolean; distance: number } {
  const distance = haversineDistance(studentLat, studentLng, sessionLat, sessionLng);
  return {
    within: distance <= radiusMeters,
    distance: Math.round(distance * 100) / 100,
  };
}

/**
 * Check for GPS velocity anomalies (spoofing detection)
 * Compares current position with last attendance to detect impossible speeds
 */
export async function checkGpsVelocityAnomaly(
  studentId: string,
  currentLat: number,
  currentLng: number,
  currentTime: Date
): Promise<{
  anomalyDetected: boolean;
  velocity: number; // m/s
  severity: "none" | "low" | "medium" | "high";
  reason?: string;
}> {
  try {
    const { db } = await import("./db");
    
    // Get the last attendance record for this student
    const lastRecord = await db.attendanceRecord.findFirst({
      where: { studentId },
      select: {
        gpsLat: true,
        gpsLng: true,
        markedAt: true,
      },
      orderBy: { markedAt: "desc" },
      take: 1,
    });

    if (!lastRecord) {
      // First attendance, no anomaly
      return { anomalyDetected: false, velocity: 0, severity: "none" };
    }

    const timeDiffSeconds = (currentTime.getTime() - lastRecord.markedAt.getTime()) / 1000;

    // Ignore if less than 120 seconds apart (probably same session retrying)
    if (timeDiffSeconds < 120) {
      return { anomalyDetected: false, velocity: 0, severity: "none" };
    }

    const distanceMeters = haversineDistance(
      lastRecord.gpsLat,
      lastRecord.gpsLng,
      currentLat,
      currentLng
    );

    // Calculate velocity in m/s
    const velocity = distanceMeters / timeDiffSeconds;

    // Maximum reasonable speed: 40 m/s (144 km/h - highway speed)
    const MAX_REASONABLE_VELOCITY = 40;
    
    if (velocity > MAX_REASONABLE_VELOCITY) {
      const severity = velocity > 100 ? "high" : "medium";
      return {
        anomalyDetected: true,
        velocity,
        severity,
        reason: `Impossible velocity: ${(velocity * 3.6).toFixed(2)} km/h`,
      };
    }

    // Running speed threshold (6-10 m/s)
    if (velocity > 10) {
      return {
        anomalyDetected: true,
        velocity,
        severity: "low",
        reason: `Unusual velocity: ${(velocity * 3.6).toFixed(2)} km/h`,
      };
    }

    return {
      anomalyDetected: false,
      velocity,
      severity: "none",
    };
  } catch (error) {
    console.error("[v0] GPS velocity check error:", error);
    return { anomalyDetected: false, velocity: 0, severity: "none" };
  }
}

/**
 * Check for location jump patterns between sessions
 */
export async function checkLocationJumpPattern(
  studentId: string,
  currentLat: number,
  currentLng: number
): Promise<{
  jump: boolean;
  maxDistanceMeters: number;
  unusualDistance: boolean;
}> {
  try {
    const { db } = await import("./db");
    
    // Get last 10 attendance records
    const recentRecords = await db.attendanceRecord.findMany({
      where: { studentId },
      select: {
        gpsLat: true,
        gpsLng: true,
      },
      orderBy: { markedAt: "desc" },
      take: 10,
    });

    if (recentRecords.length === 0) {
      return { jump: false, maxDistanceMeters: 0, unusualDistance: false };
    }

    // Calculate distances to all recent locations
    const distances = recentRecords.map((record) =>
      haversineDistance(currentLat, currentLng, record.gpsLat, record.gpsLng)
    );

    const maxDistance = Math.max(...distances);
    const medianDistance =
      distances.sort((a, b) => a - b)[Math.floor(distances.length / 2)];

    // Flag if median distance from normal location is >50km
    const unusualDistance = medianDistance > 50_000;

    return {
      jump: unusualDistance,
      maxDistanceMeters: maxDistance,
      unusualDistance,
    };
  } catch (error) {
    console.error("[v0] Location jump check error:", error);
    return { jump: false, maxDistanceMeters: 0, unusualDistance: false };
  }
}
