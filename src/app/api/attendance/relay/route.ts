import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  registerRelayDevice,
  startRelayBroadcast,
  recordRelayAttendance,
  getSessionRelayDevices,
  approveRelayDevice,
  revokeRelayDevice,
  getRelayStatistics,
} from "@/lib/ble-relay";

type RelaySessionAccessRow = {
  id: string;
  lecturerId: string;
  course: {
    organizationId: string;
    enrollments: Array<{ id: string }>;
  };
};

async function getRelaySessionAccess(sessionId: string, userId?: string) {
  return db.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      lecturerId: true,
      course: {
        select: {
          organizationId: true,
          enrollments: userId
            ? {
                where: { studentId: userId },
                select: { id: true },
                take: 1,
              }
            : false,
        },
      },
    },
  });
}

function canAccessRelaySession(user: any, sessionRow: RelaySessionAccessRow) {
  if (user.role === "LECTURER") {
    return sessionRow.lecturerId === user.id;
  }

  if (user.role === "STUDENT") {
    return sessionRow.course.enrollments.length > 0;
  }

  if (user.role === "ADMIN") {
    return (
      typeof user.organizationId === "string" &&
      user.organizationId === sessionRow.course.organizationId
    );
  }

  return user.role === "SUPER_ADMIN";
}

/**
 * GET /api/attendance/relay?sessionId=xxx
 * Get list of approved relay devices for a session (for students to scan from)
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    const access = await getRelaySessionAccess(sessionId, session.user.id);
    if (!access || !canAccessRelaySession(session.user, access as RelaySessionAccessRow)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

      const access = await getRelaySessionAccess(sessionId, session.user.id);
      if (!access || !canAccessRelaySession(session.user, access as RelaySessionAccessRow)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const userDevice = await db.userDevice.findFirst({
        where: {
          id: userDeviceId,
          userId: session.user.id,
          revokedAt: null,
        },
        select: { id: true },
      });

      if (!userDevice) {
        return NextResponse.json(
          { error: "Device not found or not owned by you" },
          { status: 403 }
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

      const access = await getRelaySessionAccess(sessionId, session.user.id);
      if (!access || !canAccessRelaySession(session.user, access as RelaySessionAccessRow)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const result = await startRelayBroadcast(
        relayDeviceId,
        qrToken,
        sessionId,
        session.user.id
      );

      return NextResponse.json(result);
    }

    if (action === "record_scan") {
      if (session.user.role !== "STUDENT") {
        return NextResponse.json(
          { error: "Only students can record scans" },
          { status: 403 }
        );
      }

      const attendanceRecordId =
        typeof body.attendanceRecordId === "string" ? body.attendanceRecordId : null;
      if (!relayDeviceId) {
        return NextResponse.json(
          { error: "Relay device ID required" },
          { status: 400 }
        );
      }

      const relayDevice = await db.bleRelayDevice.findUnique({
        where: { id: relayDeviceId },
        select: {
          id: true,
          sessionId: true,
          session: {
            select: {
              lecturerId: true,
              course: {
                select: {
                  organizationId: true,
                  enrollments: {
                    where: { studentId: session.user.id },
                    select: { id: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (
        !relayDevice ||
        !canAccessRelaySession(session.user, {
          id: relayDevice.sessionId,
          lecturerId: relayDevice.session.lecturerId,
          course: relayDevice.session.course,
        })
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const attendanceRecord = attendanceRecordId
        ? await db.attendanceRecord.findFirst({
            where: {
              id: attendanceRecordId,
              studentId: session.user.id,
              sessionId: relayDevice.sessionId,
            },
            select: { id: true },
          })
        : await db.attendanceRecord.findFirst({
            where: {
              studentId: session.user.id,
              sessionId: relayDevice.sessionId,
            },
            select: { id: true },
          });

      if (!attendanceRecord) {
        return NextResponse.json(
          { error: "Attendance record not found for this session" },
          { status: 404 }
        );
      }

      const result = await recordRelayAttendance(
        attendanceRecord.id,
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
          sessionId: true,
          session: { select: { lecturerId: true } },
        },
      });

      if (
        !relayDevice ||
        relayDevice.sessionId !== sessionId ||
        relayDevice.session.lecturerId !== session.user.id
      ) {
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

      const relayDevice = await db.bleRelayDevice.findUnique({
        where: { id: relayDeviceId },
        select: {
          sessionId: true,
          session: { select: { lecturerId: true } },
        },
      });

      if (
        !relayDevice ||
        relayDevice.sessionId !== sessionId ||
        relayDevice.session.lecturerId !== session.user.id
      ) {
        return NextResponse.json(
          { error: "Unauthorized - not your session" },
          { status: 403 }
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

      if (!["LECTURER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const access = await getRelaySessionAccess(sessionId, session.user.id);
      if (!access || !canAccessRelaySession(session.user, access as RelaySessionAccessRow)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
