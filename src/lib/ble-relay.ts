/**
 * BLE Relay System - Peer-to-peer QR code broadcasting via Bluetooth Low Energy
 * 
 * Flow:
 * 1. Student marks attendance successfully (passes verification)
 * 2. Student's device becomes eligible to broadcast QR as BLE relay
 * 3. Lecturer approves/manages relay devices
 * 4. Friends with bad cameras can scan QR from relay device's BLE broadcast
 * 5. BLE proximity verification ensures physical closeness
 */

import { db } from "./db";
import { v4 as uuid } from "uuid";
import { deriveAttendancePhase } from "./attendance";
import { verifyQrTokenStrict } from "./qr";
import { getFreshBleRelayLease } from "./lecturer-ble";

export interface RelayBroadcastData {
  sessionId: string;
  qrToken: string;
  qrTimestamp: number;
  relayDeviceId: string;
  courseCode: string;
  broadcastPower: number;
}

/**
 * Register a student device as eligible for BLE relay broadcasting
 * Called after student passes initial verification
 */
export async function registerRelayDevice(
  sessionId: string,
  studentId: string,
  userDeviceId: string
): Promise<{
  success: boolean;
  relayDeviceId?: string;
  message: string;
}> {
  try {
    // Check if session exists and relay is enabled
    const session = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        courseId: true,
        relayEnabled: true,
        status: true,
        phase: true,
        endsAt: true,
      },
    });

    if (!session) {
      return { success: false, message: "Session not found" };
    }

    if (!session.relayEnabled) {
      return {
        success: false,
        message: "BLE relay is not enabled for this session",
      };
    }

    const activePhase = deriveAttendancePhase(
      {
        status: session.status,
        phase: session.phase,
        endsAt: session.endsAt,
      },
      new Date()
    );

    if (activePhase === "CLOSED") {
      return {
        success: false,
        message: "Session is no longer active",
      };
    }

    const verifiedAttendance = await db.attendanceRecord.findFirst({
      where: {
        sessionId,
        studentId,
      },
      select: {
        id: true,
        faceVerified: true,
      },
    });

    if (!verifiedAttendance) {
      return {
        success: false,
        message: "Mark attendance successfully before registering as a relay device",
      };
    }

    // Check if this student already has a relay device for this session
    const existing = await db.bleRelayDevice.findUnique({
      where: {
        sessionId_studentId: {
          sessionId,
          studentId,
        },
      },
      select: { id: true, status: true },
    });

    if (existing) {
      return {
        success: true,
        relayDeviceId: existing.id,
        message: `Relay device already registered with status: ${existing.status}`,
      };
    }

    // Generate unique beacon UUID for this relay broadcast
    const beaconUuid = uuid();

    // Create relay device record
    const relayDevice = await db.bleRelayDevice.create({
      data: {
        sessionId,
        studentId,
        userDeviceId,
        status: "PENDING", // Awaiting lecturer approval
        bleBeaconUuid: beaconUuid,
        broadcastPower: -5, // Standard BLE TX power in dBm
        broadcastRangeMeters: 15, // Typical indoor range
        verifiedAt: new Date(),
      },
      select: { id: true },
    });

    // Update broadcast state
    await updateRelayBroadcastState(sessionId);

    return {
      success: true,
      relayDeviceId: relayDevice.id,
      message: "Relay device registered. Awaiting lecturer approval.",
    };
  } catch (error) {
    console.error("[v0] Register relay device error:", error);
    return {
      success: false,
      message: "Failed to register relay device",
    };
  }
}

/**
 * Start BLE beacon broadcast on a student's device
 * Only works if device is approved by lecturer
 */
export async function startRelayBroadcast(
  relayDeviceId: string,
  qrToken: string,
  sessionId: string,
  studentId: string
): Promise<{
  success: boolean;
  broadcastData?: RelayBroadcastData;
  message: string;
}> {
  try {
    const relayDevice = await db.bleRelayDevice.findUnique({
      where: { id: relayDeviceId },
      select: {
        id: true,
        sessionId: true,
        status: true,
        bleBeaconUuid: true,
        broadcastPower: true,
        studentId: true,
      },
    });

    if (!relayDevice) {
      return { success: false, message: "Relay device not found" };
    }

    if (relayDevice.status !== "APPROVED") {
      return {
        success: false,
        message: `Cannot broadcast - device status is ${relayDevice.status}`,
      };
    }

    if (relayDevice.sessionId !== sessionId) {
      return {
        success: false,
        message: "Session mismatch",
      };
    }

    if (relayDevice.studentId !== studentId) {
      return {
        success: false,
        message: "Unauthorized relay device",
      };
    }

    // Get session info
    const session = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        courseId: true,
        status: true,
        phase: true,
        endsAt: true,
        relayEnabled: true,
        qrSecret: true,
        qrRotationMs: true,
        qrGraceMs: true,
        course: { select: { code: true } },
      },
    });

    if (!session) {
      return { success: false, message: "Session not found" };
    }

    if (!session.relayEnabled) {
      return {
        success: false,
        message: "BLE relay is not enabled for this session",
      };
    }

    const relayLease = await getFreshBleRelayLease(sessionId);
    if (!relayLease) {
      return {
        success: false,
        message:
          "Lecturer BLE heartbeat is required before relay broadcast can start",
      };
    }

    const activePhase = deriveAttendancePhase(
      {
        status: session.status,
        phase: session.phase,
        endsAt: session.endsAt,
      },
      new Date()
    );

    if (activePhase === "CLOSED") {
      return {
        success: false,
        message: "Session is no longer active",
      };
    }

    const tokenValid = verifyQrTokenStrict(
      session.qrSecret,
      qrToken,
      activePhase,
      Date.now(),
      session.qrRotationMs,
      session.qrGraceMs
    );

    if (!tokenValid) {
      return {
        success: false,
        message: "QR token is invalid or expired for relay broadcast",
      };
    }

    // Update last broadcast time
    await db.bleRelayDevice.update({
      where: { id: relayDeviceId },
      data: { lastBroadcasted: new Date() },
    });

    // Construct broadcast data for the client
    const broadcastData: RelayBroadcastData = {
      sessionId,
      qrToken,
      qrTimestamp: Date.now(),
      relayDeviceId,
      courseCode: session.course.code,
      broadcastPower: relayDevice.broadcastPower || -5,
    };

    return {
      success: true,
      broadcastData,
      message: "Broadcast started successfully",
    };
  } catch (error) {
    console.error("[v0] Start relay broadcast error:", error);
    return {
      success: false,
      message: "Failed to start broadcast",
    };
  }
}

/**
 * Student scans QR from relay device instead of direct QR
 * Marks that they used relay verification
 */
export async function recordRelayAttendance(
  attendanceRecordId: string,
  relayDeviceId: string,
  bleRssi?: number,
  bleDistance?: number
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const relayDevice = await db.bleRelayDevice.findUnique({
      where: { id: relayDeviceId },
      select: { id: true, sessionId: true, status: true, revokedAt: true },
    });

    if (!relayDevice) {
      return {
        success: false,
        message: "Relay device not found",
      };
    }

    if (relayDevice.status !== "APPROVED" || relayDevice.revokedAt) {
      return {
        success: false,
        message: "Relay device is not approved for attendance sharing",
      };
    }

    // Check if relay record already exists
    const existing = await db.relayAttendanceRecord.findUnique({
      where: { attendanceRecordId },
    });

    if (existing) {
      return {
        success: true,
        message: "Relay attendance already recorded",
      };
    }

    const relayLease = await getFreshBleRelayLease(relayDevice.sessionId);
    if (!relayLease) {
      return {
        success: false,
        message:
          "Lecturer BLE heartbeat is required before relay attendance can be recorded",
      };
    }

    const attendanceRecord = await db.attendanceRecord.findUnique({
      where: { id: attendanceRecordId },
      select: { id: true, sessionId: true },
    });

    if (!attendanceRecord || attendanceRecord.sessionId !== relayDevice.sessionId) {
      return {
        success: false,
        message: "Attendance record does not belong to this relay session",
      };
    }

    // Create relay attendance record
    await db.relayAttendanceRecord.create({
      data: {
        attendanceRecordId,
        relayDeviceId,
        bleSignalRssi: bleRssi,
        bleDistance: bleDistance,
      },
    });

    // Increment scan count on relay device
    await db.bleRelayDevice.update({
      where: { id: relayDeviceId },
      data: {
        relayScansCount: { increment: 1 },
      },
    });

    return {
      success: true,
      message: "Relay attendance recorded",
    };
  } catch (error) {
    console.error("[v0] Record relay attendance error:", error);
    return {
      success: false,
      message: "Failed to record relay attendance",
    };
  }
}

/**
 * Get list of relay devices available for a session
 * Used by students to scan from friends' devices
 */
export async function getSessionRelayDevices(sessionId: string): Promise<{
  approvedRelays: Array<{
    id: string;
    studentName: string;
    deviceName: string;
    broadcastRangeMeters: number;
    scansAvailable: boolean;
    scanCount: number;
  }>;
  totalApproved: number;
  relayEnabled: boolean;
  relayLeaseActive: boolean;
  relayLeaseExpiresAt: string | null;
}> {
  try {
    const relays = await db.bleRelayDevice.findMany({
      where: {
        sessionId,
        status: "APPROVED",
        revokedAt: null,
      },
      select: {
        id: true,
        broadcastRangeMeters: true,
        relayScansCount: true,
        student: { select: { name: true } },
        userDevice: { select: { deviceName: true } },
      },
      orderBy: { approvedAt: "desc" },
    });

    const session = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      select: { relayEnabled: true },
    });
    const relayLease = await getFreshBleRelayLease(sessionId);

    return {
      approvedRelays: relays.map((relay) => ({
        id: relay.id,
        studentName: relay.student.name,
        deviceName: relay.userDevice.deviceName,
        broadcastRangeMeters: relay.broadcastRangeMeters || 15,
        scansAvailable: true, // Can implement scan limits if needed
        scanCount: relay.relayScansCount,
      })),
      totalApproved: relays.length,
      relayEnabled: session?.relayEnabled || false,
      relayLeaseActive: Boolean(relayLease),
      relayLeaseExpiresAt: relayLease?.expiresAt ?? null,
    };
  } catch (error) {
    console.error("[v0] Get relay devices error:", error);
    return {
      approvedRelays: [],
      totalApproved: 0,
      relayEnabled: false,
      relayLeaseActive: false,
      relayLeaseExpiresAt: null,
    };
  }
}

/**
 * Lecturer approves/rejects relay device
 */
export async function approveRelayDevice(
  relayDeviceId: string,
  approved: boolean,
  message?: string
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const update = approved
      ? {
          status: "APPROVED" as const,
          approvedAt: new Date(),
          approvalMessage: message,
        }
      : {
          status: "REJECTED" as const,
          rejectedAt: new Date(),
          approvalMessage: message,
        };

    const relayDevice = await db.bleRelayDevice.update({
      where: { id: relayDeviceId },
      data: update,
      select: {
        id: true,
        sessionId: true,
        status: true,
        student: { select: { name: true } },
      },
    });

    // Update broadcast state
    await updateRelayBroadcastState(relayDevice.sessionId);

    return {
      success: true,
      message: approved ? "Device approved for relay" : "Device rejected",
    };
  } catch (error) {
    console.error("[v0] Approve relay device error:", error);
    return {
      success: false,
      message: "Failed to update relay device approval",
    };
  }
}

/**
 * Revoke a previously approved relay device
 */
export async function revokeRelayDevice(
  relayDeviceId: string,
  reason?: string
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const relayDevice = await db.bleRelayDevice.update({
      where: { id: relayDeviceId },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        approvalMessage: reason,
      },
      select: { sessionId: true },
    });

    // Update broadcast state
    await updateRelayBroadcastState(relayDevice.sessionId);

    return {
      success: true,
      message: "Relay device revoked",
    };
  } catch (error) {
    console.error("[v0] Revoke relay device error:", error);
    return {
      success: false,
      message: "Failed to revoke relay device",
    };
  }
}

/**
 * Update relay broadcast state for real-time monitoring
 */
export async function updateRelayBroadcastState(
  sessionId: string
): Promise<void> {
  try {
    const approvedCount = await db.bleRelayDevice.count({
      where: {
        sessionId,
        status: "APPROVED",
        revokedAt: null,
      },
    });
    const relayLease = await getFreshBleRelayLease(sessionId);

    // Find or create broadcast state
    await db.relayBroadcastState.upsert({
      where: { sessionId },
      create: {
        sessionId,
        activeRelays: relayLease ? approvedCount : 0,
        totalApproved: approvedCount,
      },
      update: {
        activeRelays: relayLease ? approvedCount : 0,
        totalApproved: approvedCount,
        lastUpdated: new Date(),
      },
    });
  } catch (error) {
    console.error("[v0] Update relay broadcast state error:", error);
  }
}

/**
 * Get relay statistics for a session
 */
export async function getRelayStatistics(sessionId: string): Promise<{
  totalRelays: number;
  pendingApprovals: number;
  approvedRelays: number;
  rejectedRelays: number;
  revokedRelays: number;
  totalRelayScans: number;
  activeRelays: number;
}> {
  try {
    const [stats, broadcastState, relayLease] = await Promise.all([
      db.bleRelayDevice.groupBy({
        by: ["status"],
        where: { sessionId },
        _count: true,
      }),
      db.relayBroadcastState.findUnique({
        where: { sessionId },
        select: { activeRelays: true },
      }),
      getFreshBleRelayLease(sessionId),
    ]);

    const totalScans = await db.relayAttendanceRecord.count({
      where: {
        relayDevice: { sessionId },
      },
    });

    const statusMap = new Map(stats.map((s) => [s.status, s._count]));
    const approvedCount = statusMap.get("APPROVED") || 0;

    return {
      totalRelays: stats.reduce((sum, s) => sum + s._count, 0),
      pendingApprovals: statusMap.get("PENDING") || 0,
      approvedRelays: approvedCount,
      rejectedRelays: statusMap.get("REJECTED") || 0,
      revokedRelays: statusMap.get("REVOKED") || 0,
      totalRelayScans: totalScans,
      activeRelays: relayLease ? broadcastState?.activeRelays || approvedCount : 0,
    };
  } catch (error) {
    console.error("[v0] Get relay statistics error:", error);
    return {
      totalRelays: 0,
      pendingApprovals: 0,
      approvedRelays: 0,
      rejectedRelays: 0,
      revokedRelays: 0,
      totalRelayScans: 0,
      activeRelays: 0,
    };
  }
}

/**
 * Clean up expired relay devices (when session closes)
 */
export async function cleanupExpiredRelayDevices(sessionId: string): Promise<{
  success: boolean;
  cleanedCount: number;
}> {
  try {
    const result = await db.bleRelayDevice.updateMany({
      where: {
        sessionId,
        status: {
          in: ["PENDING", "APPROVED"],
        },
      },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        approvalMessage: "Session ended",
      },
    });

    return {
      success: true,
      cleanedCount: result.count,
    };
  } catch (error) {
    console.error("[v0] Cleanup relay devices error:", error);
    return {
      success: false,
      cleanedCount: 0,
    };
  }
}
