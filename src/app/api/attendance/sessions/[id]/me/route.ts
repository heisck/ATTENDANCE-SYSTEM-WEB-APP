import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPhaseEndsAt, syncAttendanceSessionState } from "@/lib/attendance";
import { getQrPortStatus } from "@/lib/qr-port";
import { db } from "@/lib/db";
import { getQrSequence } from "@/lib/qr";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getStudentPhaseCompletionForCourseDay } from "@/lib/phase-completion";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Only students can access this endpoint" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const cacheKey = `attendance:session-me:${id}:${user.id}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    include: {
      course: {
        include: {
          enrollments: {
            where: { studentId: user.id },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!attendanceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (attendanceSession.course.enrollments.length === 0) {
    return NextResponse.json(
      { error: "You are not enrolled in this course" },
      { status: 403 }
    );
  }

  const phaseCompletion = await getStudentPhaseCompletionForCourseDay({
    studentId: user.id,
    courseId: attendanceSession.courseId,
    lecturerId: attendanceSession.lecturerId,
    referenceTime: attendanceSession.startedAt,
  });

  if (syncedSession.status !== "ACTIVE") {
    const currentSequence = getQrSequence(Date.now(), syncedSession.qrRotationMs);
    return NextResponse.json(
      {
        error: "Session is no longer active",
        serverNow: new Date().toISOString(),
        session: {
          id: syncedSession.id,
          status: syncedSession.status,
          phase: syncedSession.phase,
          phaseEndsAt: getPhaseEndsAt(syncedSession),
          currentSequenceId: `E${String(currentSequence).padStart(3, "0")}`,
          nextSequenceId: `E${String(currentSequence + 1).padStart(3, "0")}`,
        },
        attendance: null,
        qrPortStatus: null,
        phaseCompletion,
      },
      { status: 410 }
    );
  }

  const record = await db.attendanceRecord.findUnique({
    where: {
      sessionId_studentId: {
        sessionId: id,
        studentId: user.id,
      },
    },
    select: {
      id: true,
      markedAt: true,
      flagged: true,
      confidence: true,
      webauthnUsed: true,
      qrToken: true,
      bleSignalStrength: true,
    },
  });

  const currentSequence = getQrSequence(Date.now(), syncedSession.qrRotationMs);
  const qrPortStatus = await getQrPortStatus(id, user.id);

  const payload = {
    serverNow: new Date().toISOString(),
    session: {
      id: syncedSession.id,
      status: syncedSession.status,
      phase: syncedSession.phase,
      phaseEndsAt: getPhaseEndsAt(syncedSession),
      currentSequenceId: `E${String(currentSequence).padStart(3, "0")}`,
      nextSequenceId: `E${String(currentSequence + 1).padStart(3, "0")}`,
    },
    attendance: record
      ? {
          id: record.id,
          markedAt: record.markedAt,
          flagged: record.flagged,
          confidence: record.confidence,
          layers: {
            webauthn: Boolean(record.webauthnUsed),
            qr: typeof record.qrToken === "string" && record.qrToken.length > 0,
            ble: record.bleSignalStrength != null,
          },
        }
      : null,
    qrPortStatus,
    phaseCompletion,
  };

  await cacheSet(cacheKey, payload, 2);
  return NextResponse.json(payload);
}
