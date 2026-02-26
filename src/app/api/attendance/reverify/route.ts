import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getReverifySlotFromRecord, syncAttendanceSessionState } from "@/lib/attendance";
import { verifyQrTokenForSequence } from "@/lib/qr";

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
        reverifyRequestedAt: true,
        reverifyDeadlineAt: true,
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

    const slot = getReverifySlotFromRecord(
      record.reverifyRequestedAt,
      record.reverifyDeadlineAt,
      syncedSession.qrRotationMs,
      syncedSession.qrGraceMs
    );
    if (!slot) {
      return NextResponse.json(
        { error: "Your reverification slot has not been assigned yet." },
        { status: 409 }
      );
    }

    const nowTs = Date.now();
    const maxScanAgeMs = syncedSession.qrRotationMs + syncedSession.qrGraceMs;
    const scanAgeMs = nowTs - qrTimestamp;
    if (scanAgeMs > maxScanAgeMs || scanAgeMs < -1_500) {
      return NextResponse.json(
        { error: "QR scan is out of the allowed 6-second validation window. Scan again." },
        { status: 400 }
      );
    }

    const now = new Date(nowTs);
    if (now < slot.startsAt) {
      return NextResponse.json(
        {
          error: `Your slot has not started yet. Scan ${slot.sequenceId} at ${slot.startsAt.toLocaleTimeString()}.`,
        },
        { status: 409 }
      );
    }
    if (now > slot.endsAt) {
      return NextResponse.json(
        {
          error:
            "Your assigned slot just expired. Stay on the page; the system will move you to the next available slot automatically.",
        },
        { status: 409 }
      );
    }

    const qrValid = verifyQrTokenForSequence(
      attendanceSession.qrSecret,
      qrToken,
      "REVERIFY",
      slot.sequence
    );
    if (!qrValid) {
      return NextResponse.json(
        { error: `Invalid QR for your slot. Wait for ${slot.sequenceId} and scan that exact code.` },
        { status: 400 }
      );
    }

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

    return NextResponse.json({
      success: true,
      record: updated,
      slot: {
        sequence: slot.sequence,
        sequenceId: slot.sequenceId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
