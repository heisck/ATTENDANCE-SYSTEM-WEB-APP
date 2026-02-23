import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncAttendanceSessionState } from "@/lib/attendance";
import { verifyQrTokenStrict } from "@/lib/qr";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can submit reverification" },
      { status: 403 }
    );
  }

  const [studentState, credentialCount] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: { personalEmail: true, personalEmailVerifiedAt: true },
    }),
    db.webAuthnCredential.count({
      where: { userId: user.id },
    }),
  ]);
  if (!studentState?.personalEmail || !studentState.personalEmailVerifiedAt) {
    return NextResponse.json(
      { error: "Complete and verify your personal email before reverification." },
      { status: 403 }
    );
  }
  if (credentialCount === 0) {
    return NextResponse.json(
      { error: "Register a passkey before reverification." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    const qrToken = typeof body?.qrToken === "string" ? body.qrToken : "";
    const qrTimestamp = Number(body?.qrTimestamp);
    const webauthnVerified = body?.webauthnVerified === true;

    if (!sessionId || !qrToken) {
      return NextResponse.json(
        { error: "sessionId and qrToken are required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(qrTimestamp)) {
      return NextResponse.json(
        { error: "Valid qrTimestamp is required" },
        { status: 400 }
      );
    }

    const scanSkewMs = Math.abs(Date.now() - qrTimestamp);
    if (scanSkewMs > 8_000) {
      return NextResponse.json(
        { error: "QR scan is too old. Scan again and submit immediately." },
        { status: 400 }
      );
    }

    if (!webauthnVerified) {
      return NextResponse.json(
        { error: "Passkey verification is required for reverification" },
        { status: 400 }
      );
    }

    const syncedSession = await syncAttendanceSessionState(sessionId);
    if (!syncedSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (syncedSession.status !== "ACTIVE" || syncedSession.phase !== "REVERIFY") {
      return NextResponse.json(
        { error: "Reverification window is not active" },
        { status: 410 }
      );
    }

    const attendanceSession = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      select: { id: true, qrSecret: true },
    });
    if (!attendanceSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const record = await db.attendanceRecord.findUnique({
      where: {
        sessionId_studentId: {
          sessionId,
          studentId: user.id,
        },
      },
      select: {
        id: true,
        reverifyRequired: true,
        reverifyStatus: true,
      },
    });

    if (!record) {
      return NextResponse.json(
        { error: "You must complete initial attendance before reverification" },
        { status: 403 }
      );
    }

    if (!record.reverifyRequired) {
      return NextResponse.json(
        { error: "You are not currently selected for reverification" },
        { status: 403 }
      );
    }

    if (record.reverifyStatus === "PASSED" || record.reverifyStatus === "MANUAL_PRESENT") {
      return NextResponse.json(
        { error: "Reverification already completed" },
        { status: 409 }
      );
    }

    if (record.reverifyStatus !== "PENDING" && record.reverifyStatus !== "RETRY_PENDING") {
      return NextResponse.json(
        { error: "No active reverification slot. Request retry if available." },
        { status: 409 }
      );
    }

    const qrValid = verifyQrTokenStrict(
      attendanceSession.qrSecret,
      qrToken,
      "REVERIFY",
      qrTimestamp,
      syncedSession.qrRotationMs,
      syncedSession.qrGraceMs
    );
    if (!qrValid) {
      return NextResponse.json(
        { error: "QR is expired or invalid for the current reverification slot" },
        { status: 400 }
      );
    }

    const now = new Date();
    const updated = await db.attendanceRecord.update({
      where: { id: record.id },
      data: {
        reverifyStatus: "PASSED",
        reverifyMarkedAt: now,
        reverifyPasskeyUsed: true,
        flagged: false,
      },
      select: {
        id: true,
        reverifyStatus: true,
        reverifyMarkedAt: true,
      },
    });

    return NextResponse.json({ success: true, record: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
