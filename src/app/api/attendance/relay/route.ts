import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  registerRelayDevice,
  startRelayBroadcast,
  recordRelayAttendance,
  getSessionRelayDevices,
  approveRelayDevice,
  revokeRelayDevice,
  getRelayStatistics,
} from "@/lib/ble-relay";

/**
 * GET /api/attendance/relay?sessionId=xxx
 * Get list of approved relay devices for a session (for students to scan from)
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    const result = await getSessionRelayDevices(sessionId);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[v0] Relay GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch relay devices" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/attendance/relay
 * Student actions:
 * - "register": Register device as relay after successful verification
 * - "start_broadcast": Start BLE beacon broadcast
 * - "record_scan": Record that student scanned QR from relay
 *
 * Lecturer actions:
 * - "approve": Approve a relay device
 * - "reject": Reject a relay device
 * - "revoke": Revoke an approved relay device
 * - "statistics": Get relay statistics for session
 */
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, sessionId, relayDeviceId, qrToken, bleRssi, bleDistance } =
      body;

    // Student actions
    if (action === "register") {
      if (session.user.role !== "STUDENT") {
        return NextResponse.json(
          { error: "Only students can register relay devices" },
          { status: 403 }
        );
      }

      const userDeviceId = body.userDeviceId;
      if (!userDeviceId || !sessionId) {
        return NextResponse.json(
          { error: "User device ID and session ID required" },
          { status: 400 }
        );
      }

      const result = await registerRelayDevice(
        sessionId,
        session.user.id,
        userDeviceId
      );

      return NextResponse.json(result);
    }

    if (action === "start_broadcast") {
      if (session.user.role !== "STUDENT") {
        return NextResponse.json(
          { error: "Only students can broadcast" },
          { status: 403 }
        );
      }

      if (!relayDeviceId || !qrToken || !sessionId) {
        return NextResponse.json(
          { error: "Relay device ID, QR token, and session ID required" },
          { status: 400 }
        );
      }

      const result = await startRelayBroadcast(relayDeviceId, qrToken, sessionId);

      return NextResponse.json(result);
    }

    if (action === "record_scan") {
      if (session.user.role !== "STUDENT") {
        return NextResponse.json(
          { error: "Only students can record scans" },
          { status: 403 }
        );
      }

      const attendanceRecordId = body.attendanceRecordId;
      if (!attendanceRecordId || !relayDeviceId) {
        return NextResponse.json(
          { error: "Attendance record ID and relay device ID required" },
          { status: 400 }
        );
      }

      const result = await recordRelayAttendance(
        attendanceRecordId,
        relayDeviceId,
        bleRssi,
        bleDistance
      );

      return NextResponse.json(result);
    }

    // Lecturer actions
    if (action === "approve" || action === "reject") {
      if (session.user.role !== "LECTURER") {
        return NextResponse.json(
          { error: "Only lecturers can approve/reject relay devices" },
          { status: 403 }
        );
      }

      if (!relayDeviceId || !sessionId) {
        return NextResponse.json(
          { error: "Relay device ID and session ID required" },
          { status: 400 }
        );
      }

      // Verify lecturer owns this session
      const relayDevice = await db.bleRelayDevice.findUnique({
        where: { id: relayDeviceId },
        select: {
          session: { select: { lecturerId: true } },
        },
      });

      if (!relayDevice || relayDevice.session.lecturerId !== session.user.id) {
        return NextResponse.json(
          { error: "Unauthorized - not your session" },
          { status: 403 }
        );
      }

      const result = await approveRelayDevice(
        relayDeviceId,
        action === "approve",
        body.message
      );

      return NextResponse.json(result);
    }

    if (action === "revoke") {
      if (session.user.role !== "LECTURER") {
        return NextResponse.json(
          { error: "Only lecturers can revoke relay devices" },
          { status: 403 }
        );
      }

      if (!relayDeviceId || !sessionId) {
        return NextResponse.json(
          { error: "Relay device ID and session ID required" },
          { status: 400 }
        );
      }

      const result = await revokeRelayDevice(relayDeviceId, body.reason);

      return NextResponse.json(result);
    }

    if (action === "statistics") {
      if (!sessionId) {
        return NextResponse.json(
          { error: "Session ID required" },
          { status: 400 }
        );
      }

      // Only lecturer can view detailed stats
      if (session.user.role === "LECTURER") {
        const sessionData = await db.attendanceSession.findUnique({
          where: { id: sessionId },
          select: { lecturerId: true },
        });

        if (sessionData?.lecturerId !== session.user.id) {
          return NextResponse.json(
            { error: "Unauthorized" },
            { status: 403 }
          );
        }
      }

      const stats = await getRelayStatistics(sessionId);

      return NextResponse.json({
        success: true,
        data: stats,
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[v0] Relay POST error:", error);
    return NextResponse.json(
      { error: "Failed to process relay request" },
      { status: 500 }
    );
  }
}

// Import db for authorization checks
import { db } from "@/lib/db";
