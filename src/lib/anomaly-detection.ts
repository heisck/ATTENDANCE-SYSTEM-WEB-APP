import { db } from "./db";
import { AnomalyType } from "@prisma/client";

/**
 * Comprehensive anomaly detection for attendance records
 * Analyzes behavioral patterns, device consistency, and security signals
 */

export interface AnomalyAnalysis {
  detected: boolean;
  anomalies: Array<{
    type: AnomalyType;
    severity: number; // 0-100
    confidence: number; // 0-1.0
    reason: string;
  }>;
  overallRisk: number; // 0-100
  recommendation: "APPROVE" | "REVIEW" | "REJECT";
}

/**
 * Detect rapid submission attempts (brute force detection)
 */
export async function detectRapidSubmissions(
  studentId: string,
  sessionId: string,
  windowMinutes: number = 5
): Promise<{ rapid: boolean; attemptCount: number }> {
  try {
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

    const count = await db.attendanceRecord.count({
      where: {
        studentId,
        sessionId,
        markedAt: { gte: windowStart },
      },
    });

    return {
      rapid: count > 3, // More than 3 attempts in 5 minutes
      attemptCount: count,
    };
  } catch (error) {
    console.error("[v0] Rapid submission detection error:", error);
    return { rapid: false, attemptCount: 0 };
  }
}

/**
 * Detect timezone anomalies
 * If student's timezone differs significantly from campus, might indicate location spoofing
 */
export function detectTimezoneAnomaly(
  studentTimezone: string,
  campusTimezone: string
): { anomaly: boolean; hoursDifference: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: studentTimezone,
    });
    const studentTime = formatter.format(new Date());

    const campusFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: campusTimezone,
    });
    const campusTime = campusFormatter.format(new Date());

    // For now, simplified detection - in production use better timezone library
    const hoursRegex = /(\d+):/;
    const studentHour = parseInt(studentTime.match(hoursRegex)?.[1] || "0");
    const campusHour = parseInt(campusTime.match(hoursRegex)?.[1] || "0");

    const diff = Math.abs(studentHour - campusHour);
    const anomaly = diff > 6; // More than 6 hours difference is suspicious

    return { anomaly, hoursDifference: diff };
  } catch (error) {
    console.error("[v0] Timezone anomaly detection error:", error);
    return { anomaly: false, hoursDifference: 0 };
  }
}

/**
 * Detect QR token reuse (same QR used by multiple students in short time)
 */
export async function detectQrReuse(
  qrToken: string,
  sessionId: string,
  currentStudentId: string,
  windowSeconds: number = 10
): Promise<{ reuse: boolean; otherStudents: number }> {
  try {
    const recentUses = await db.attendanceRecord.findMany({
      where: {
        sessionId,
        qrToken,
        markedAt: {
          gte: new Date(Date.now() - windowSeconds * 1000),
        },
      },
      distinct: ["studentId"],
      select: { studentId: true },
    });

    const otherStudents = recentUses.filter((r) => r.studentId !== currentStudentId).length;

    return {
      reuse: otherStudents > 0,
      otherStudents,
    };
  } catch (error) {
    console.error("[v0] QR reuse detection error:", error);
    return { reuse: false, otherStudents: 0 };
  }
}

/**
 * Comprehensive anomaly analysis for an attendance record
 */
export async function analyzeAttendanceAnomaly(
  studentId: string,
  sessionId: string,
  attendanceData: {
    confidence: number;
    flagged: boolean;
    gpsVelocity?: number;
    deviceConsistency?: number;
    bleSignalStrength?: number;
    qrToken?: string;
  }
): Promise<AnomalyAnalysis> {
  try {
    const anomalies: AnomalyAnalysis["anomalies"] = [];
    let totalSeverity = 0;

    // Check GPS velocity anomaly
    if (attendanceData.gpsVelocity && attendanceData.gpsVelocity > 40) {
      anomalies.push({
        type: "VELOCITY_ANOMALY",
        severity: attendanceData.gpsVelocity > 100 ? 90 : 60,
        confidence: 0.9,
        reason: `Impossible movement speed: ${(attendanceData.gpsVelocity * 3.6).toFixed(0)} km/h`,
      });
    }

    // Check device consistency
    if (
      attendanceData.deviceConsistency !== undefined &&
      attendanceData.deviceConsistency < 40
    ) {
      anomalies.push({
        type: "DEVICE_MISMATCH",
        severity: 50,
        confidence: 0.8,
        reason: `Unusual device usage pattern (consistency: ${Math.round(attendanceData.deviceConsistency)}%)`,
      });
    }

    // Check BLE signal (if using multi-device verification)
    if (attendanceData.bleSignalStrength && attendanceData.bleSignalStrength < -95) {
      anomalies.push({
        type: "VELOCITY_ANOMALY", // Could be spoofing
        severity: 30,
        confidence: 0.6,
        reason: "BLE signal very weak or unreachable",
      });
    }

    // Check QR reuse
    if (attendanceData.qrToken) {
      const qrCheck = await detectQrReuse(
        attendanceData.qrToken,
        sessionId,
        studentId,
        10
      );
      if (qrCheck.reuse) {
        anomalies.push({
          type: "GPS_SPOOFING", // Likely QR sharing
          severity: 85,
          confidence: 0.95,
          reason: `QR token used by ${qrCheck.otherStudents} other student(s) within 10 seconds`,
        });
      }
    }

    // Check rapid submissions
    const rapidCheck = await detectRapidSubmissions(studentId, sessionId);
    if (rapidCheck.rapid) {
      anomalies.push({
        type: "RAPID_SUBMISSIONS",
        severity: 60,
        confidence: 0.85,
        reason: `${rapidCheck.attemptCount} submission attempts in 5 minutes`,
      });
    }

    // Calculate overall risk
    totalSeverity = anomalies.length > 0
      ? anomalies.reduce((sum, a) => sum + a.severity, 0) / anomalies.length
      : 0;

    // Low confidence is itself an anomaly
    if (attendanceData.confidence < 50) {
      totalSeverity = Math.max(totalSeverity, 70);
    }

    // Determine recommendation
    let recommendation: AnomalyAnalysis["recommendation"] = "APPROVE";
    if (totalSeverity >= 70 || anomalies.some((a) => a.severity >= 80)) {
      recommendation = "REJECT";
    } else if (totalSeverity >= 50 || anomalies.length > 0) {
      recommendation = "REVIEW";
    }

    return {
      detected: anomalies.length > 0 || attendanceData.flagged,
      anomalies,
      overallRisk: Math.round(totalSeverity),
      recommendation,
    };
  } catch (error) {
    console.error("[v0] Anomaly analysis error:", error);
    return {
      detected: false,
      anomalies: [],
      overallRisk: 0,
      recommendation: "APPROVE",
    };
  }
}

/**
 * Get behavioral profile for a student
 * Used to detect deviations from normal behavior
 */
export async function getStudentBehaviorProfile(
  studentId: string,
  lookbackDays: number = 30
): Promise<{
  avgConfidence: number;
  flagRate: number; // Percentage of flagged records
  deviceCount: number;
  locationConsistency: number; // How consistent are GPS locations
  typicalAttendanceTime: string; // e.g., "09:00-11:00"
}> {
  try {
    const lookbackDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const records = await db.attendanceRecord.findMany({
      where: {
        studentId,
        markedAt: { gte: lookbackDate },
      },
      select: {
        confidence: true,
        flagged: true,
        deviceToken: true,
        gpsLat: true,
        gpsLng: true,
        markedAt: true,
      },
    });

    if (records.length === 0) {
      return {
        avgConfidence: 75,
        flagRate: 0,
        deviceCount: 1,
        locationConsistency: 100,
        typicalAttendanceTime: "09:00-17:00",
      };
    }

    const avgConfidence =
      Math.round(
        records.reduce((sum, r) => sum + r.confidence, 0) / records.length
      ) || 75;

    const flagRate = Math.round(
      (records.filter((r) => r.flagged).length / records.length) * 100
    );

    const uniqueDevices = new Set(records.map((r) => r.deviceToken)).size;

    // Location consistency: check if GPS coordinates are clustered
    const locations = records.map((r) => ({ lat: r.gpsLat, lng: r.gpsLng }));
    const locationConsistency = calculateLocationCluster(locations);

    // Typical attendance time window
    const hours = records.map((r) => r.markedAt.getHours());
    const minHour = Math.min(...hours);
    const maxHour = Math.max(...hours);
    const typicalAttendanceTime = `${String(minHour).padStart(2, "0")}:00-${String(maxHour).padStart(2, "0")}:00`;

    return {
      avgConfidence,
      flagRate,
      deviceCount: uniqueDevices,
      locationConsistency,
      typicalAttendanceTime,
    };
  } catch (error) {
    console.error("[v0] Get behavior profile error:", error);
    return {
      avgConfidence: 75,
      flagRate: 0,
      deviceCount: 1,
      locationConsistency: 100,
      typicalAttendanceTime: "09:00-17:00",
    };
  }
}

/**
 * Helper: Calculate how clustered GPS locations are (0-100)
 */
function calculateLocationCluster(
  locations: Array<{ lat: number; lng: number }>
): number {
  if (locations.length < 2) return 100;

  // Calculate center point
  const centerLat = locations.reduce((sum, l) => sum + l.lat, 0) / locations.length;
  const centerLng = locations.reduce((sum, l) => sum + l.lng, 0) / locations.length;

  // Calculate average distance from center
  const avgDistance =
    locations.reduce((sum, l) => {
      const dLat = (l.lat - centerLat) * 111000; // 111km per degree lat
      const dLng = (l.lng - centerLng) * 111000 * Math.cos((centerLat * Math.PI) / 180);
      return sum + Math.sqrt(dLat * dLat + dLng * dLng);
    }, 0) / locations.length;

  // Convert to consistency score (0-100)
  // 0m = 100%, 1000m = 0%
  return Math.max(0, 100 - Math.round(avgDistance / 10));
}

/**
 * Flag unreviewable attendance for admin investigation
 */
export async function flagForReview(
  attendanceRecordId: string,
  anomalies: AnomalyAnalysis
): Promise<boolean> {
  try {
    const record = await db.attendanceRecord.findUnique({
      where: { id: attendanceRecordId },
      select: { studentId: true, sessionId: true },
    });

    if (!record) return false;

    // Create anomaly entries
    for (const anomaly of anomalies.anomalies) {
      await db.attendanceAnomaly.create({
        data: {
          studentId: record.studentId,
          sessionId: record.sessionId || undefined,
          anomalyType: anomaly.type,
          severity: anomaly.severity,
          confidence: anomaly.confidence,
          details: {
            reason: anomaly.reason,
            recordId: attendanceRecordId,
          },
        },
      });
    }

    // Mark record as flagged
    await db.attendanceRecord.update({
      where: { id: attendanceRecordId },
      data: { flagged: true },
    });

    return true;
  } catch (error) {
    console.error("[v0] Flag for review error:", error);
    return false;
  }
}
