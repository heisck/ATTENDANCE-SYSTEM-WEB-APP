import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { markAttendanceSchema } from "@/lib/validators";
import { verifyQrToken } from "@/lib/qr";
import { isWithinRadius } from "@/lib/gps";
import { isIpTrusted } from "@/lib/ip";
import { calculateConfidence, isFlagged } from "@/lib/confidence";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json({ error: "Only students can mark attendance" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = markAttendanceSchema.parse(body);

    const attendanceSession = await db.attendanceSession.findUnique({
      where: { id: parsed.sessionId },
      include: {
        course: {
          include: {
            organization: { include: { ipRanges: true } },
            enrollments: { where: { studentId: user.id } },
          },
        },
      },
    });

    if (!attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (attendanceSession.status !== "ACTIVE") {
      return NextResponse.json({ error: "Session is no longer active" }, { status: 410 });
    }

    if (attendanceSession.course.enrollments.length === 0) {
      return NextResponse.json({ error: "You are not enrolled in this course" }, { status: 403 });
    }

    const existing = await db.attendanceRecord.findUnique({
      where: {
        sessionId_studentId: {
          sessionId: parsed.sessionId,
          studentId: user.id,
        },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "You have already marked attendance for this session" },
        { status: 409 }
      );
    }

    const qrValid = verifyQrToken(
      attendanceSession.qrSecret,
      parsed.qrToken,
      parsed.qrTimestamp
    );

    const gpsResult = isWithinRadius(
      parsed.gpsLat,
      parsed.gpsLng,
      attendanceSession.gpsLat,
      attendanceSession.gpsLng,
      attendanceSession.radiusMeters
    );

    const clientIp =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const trustedRanges = attendanceSession.course.organization.ipRanges.map(
      (r) => r.cidr
    );
    const ipCheck = isIpTrusted(clientIp, trustedRanges);

    const webauthnUsed = body.webauthnVerified === true;

    const confidence = calculateConfidence({
      webauthnVerified: webauthnUsed,
      gpsWithinRadius: gpsResult.within,
      qrTokenValid: qrValid,
      ipTrusted: ipCheck,
    });

    const settings = attendanceSession.course.organization.settings as any;
    const threshold = settings?.confidenceThreshold || 70;
    const flagged = isFlagged(confidence, threshold);

    const record = await db.attendanceRecord.create({
      data: {
        sessionId: parsed.sessionId,
        studentId: user.id,
        gpsLat: parsed.gpsLat,
        gpsLng: parsed.gpsLng,
        gpsDistance: gpsResult.distance,
        ipAddress: clientIp,
        ipTrusted: ipCheck,
        qrToken: parsed.qrToken,
        webauthnUsed,
        confidence,
        flagged,
      },
    });

    return NextResponse.json({
      success: true,
      record: {
        id: record.id,
        confidence: record.confidence,
        flagged: record.flagged,
        gpsDistance: record.gpsDistance,
        layers: {
          webauthn: webauthnUsed,
          gps: gpsResult.within,
          qr: qrValid,
          ip: ipCheck,
        },
      },
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Mark attendance error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
