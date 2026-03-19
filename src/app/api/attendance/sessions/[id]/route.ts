import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getPhaseEndsAt,
  normalizeSessionDurationMinutes,
  syncAttendanceSessionState,
} from "@/lib/attendance";
import { generateQrPayload } from "@/lib/qr";
import { CACHE_KEYS, cacheDel } from "@/lib/cache";
import {
  buildDefaultBeaconName,
  clearSessionBleBroadcast,
  getSessionBleBroadcast,
  setSessionBleBroadcast,
} from "@/lib/lecturer-ble";

const patchSessionSchema = z
  .object({
    action: z.enum(["close", "extend"]).optional().default("close"),
    additionalMinutes: z.number().int().min(1).max(60).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "extend" && value.additionalMinutes == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["additionalMinutes"],
        message: "additionalMinutes is required when extending a session.",
      });
    }
  });

async function invalidateSessionCaches(sessionId: string, lecturerId: string, courseId: string) {
  const enrollmentRows = await db.enrollment.findMany({
    where: { courseId },
    select: { studentId: true },
  });

  await Promise.all([
    cacheDel(`attendance:session-meta:${sessionId}`),
    cacheDel(`attendance:session-secret:${sessionId}`),
    cacheDel(`attendance:mark-session:${sessionId}`),
    cacheDel(CACHE_KEYS.SESSION_STATE(sessionId)),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ACTIVE`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ALL`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:CLOSED`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ACTIVE:20`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ALL:20`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:CLOSED:20`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ACTIVE:100`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:ALL:100`),
    cacheDel(`attendance:sessions:list:LECTURER:${lecturerId}:CLOSED:100`),
    ...enrollmentRows.flatMap((row) => [
      cacheDel(`attendance:session-me:${sessionId}:${row.studentId}`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ACTIVE`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ALL`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:CLOSED`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ACTIVE:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ALL:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:CLOSED:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ACTIVE:100`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ALL:100`),
      cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:CLOSED:100`),
      cacheDel(`student:live-sessions:${row.studentId}`),
    ]),
  ]);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const syncedSession = await syncAttendanceSessionState(id);
  if (!syncedSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    include: {
      course: true,
      records: {
        include: {
          student: { select: { id: true, name: true, studentId: true } },
        },
        orderBy: { markedAt: "desc" },
      },
      _count: { select: { records: true } },
    },
  });

  if (!attendanceSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const user = session.user as any;
  const isLecturer = attendanceSession.lecturerId === user.id;
  const isAdminInOrganization =
    user.role === "ADMIN" &&
    Boolean(user.organizationId) &&
    user.organizationId === attendanceSession.course.organizationId;
  const isSuperAdmin = user.role === "SUPER_ADMIN";

  if (!isLecturer && !isAdminInOrganization && !isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let qr = null;
  if (isLecturer && syncedSession.status === "ACTIVE") {
    qr = generateQrPayload(
      attendanceSession.id,
      attendanceSession.qrSecret,
      syncedSession.phase,
      syncedSession.qrRotationMs
    );
  }

  return NextResponse.json({
    ...attendanceSession,
    status: syncedSession.status,
    phase: syncedSession.phase,
    endsAt: syncedSession.endsAt,
    phaseEndsAt: getPhaseEndsAt(syncedSession),
    qrSecret: undefined,
    qr,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const user = session.user as any;

  const attendanceSession = await db.attendanceSession.findUnique({
    where: { id },
    select: {
      id: true,
      courseId: true,
      lecturerId: true,
      durationMinutes: true,
      relayEnabled: true,
      relayOpenTime: true,
      startedAt: true,
      course: {
        select: {
          code: true,
        },
      },
    },
  });

  if (!attendanceSession || attendanceSession.lecturerId !== user.id) {
    return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSessionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid session update payload" },
      { status: 400 }
    );
  }

  if (parsed.data.action === "extend") {
    const syncedSession = await syncAttendanceSessionState(id);
    if (!syncedSession || syncedSession.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Only active sessions can be extended" },
        { status: 409 }
      );
    }

    const additionalMinutes = normalizeSessionDurationMinutes(
      parsed.data.additionalMinutes
    );
    const endsAt = new Date(
      syncedSession.endsAt.getTime() + additionalMinutes * 60_000
    );
    const updated = await db.attendanceSession.update({
      where: { id },
      data: {
        durationMinutes: attendanceSession.durationMinutes + additionalMinutes,
        endsAt,
      },
    });

    if (attendanceSession.relayEnabled) {
      const existingBroadcast = await getSessionBleBroadcast(id);
      await setSessionBleBroadcast(id, {
        lecturerId: user.id,
        beaconName:
          existingBroadcast?.beaconName ??
          buildDefaultBeaconName({
            courseCode: attendanceSession.course.code,
            sessionId: attendanceSession.id,
            phase: syncedSession.phase,
          }),
        startedAt: existingBroadcast
          ? new Date(existingBroadcast.startedAt)
          : attendanceSession.relayOpenTime ?? attendanceSession.startedAt,
        expiresAt: endsAt,
      });
    }

    await invalidateSessionCaches(id, user.id, attendanceSession.courseId);

    return NextResponse.json({
      ...updated,
      extendedByMinutes: additionalMinutes,
    });
  }

  const updated = await db.attendanceSession.update({
    where: { id },
    data: {
      status: "CLOSED",
      phase: "CLOSED",
      closedAt: new Date(),
      relayEnabled: false,
    },
  });

  try {
    await clearSessionBleBroadcast(id);
  } catch (error) {
    console.error("Failed to clear BLE broadcast during session close:", error);
  }

  await invalidateSessionCaches(id, user.id, attendanceSession.courseId);

  return NextResponse.json(updated);
}
