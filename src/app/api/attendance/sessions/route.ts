import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  deriveAttendancePhase,
  getDefaultSessionEndsAt,
  QR_GRACE_MS,
  QR_ROTATION_MS,
} from "@/lib/attendance";
import { generateQrSecret } from "@/lib/qr";
import { createSessionSchema } from "@/lib/validators";
import { cacheDel, cacheGet, cacheSet } from "@/lib/cache";
import {
  buildDefaultBeaconName,
  setSessionBleBroadcast,
} from "@/lib/lecturer-ble";
import { getStudentPhaseCompletionForCourseDay } from "@/lib/phase-completion";

const SESSION_LIST_CACHE_TTL_SECONDS = 10;

async function invalidateStudentSessionKeys(studentIds: string[]) {
  await Promise.all(
    studentIds.map((studentId) =>
      Promise.all([
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ACTIVE`),
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ALL`),
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:CLOSED`),
        cacheDel(`student:live-sessions:${studentId}`),
      ])
    )
  );
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "LECTURER") {
    return NextResponse.json(
      { error: "Only lecturers can create sessions" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = createSessionSchema.parse(body);
    const normalizedCourseCode = parsed.courseCode.trim().toUpperCase();

    const course = await db.course.findFirst({
      where: {
        code: { equals: normalizedCourseCode, mode: "insensitive" },
        lecturerId: user.id,
      },
    });
    if (!course) {
      return NextResponse.json(
        { error: "Course code not found or not assigned to you" },
        { status: 404 }
      );
    }

    const existing = await db.attendanceSession.findFirst({
      where: {
        courseId: course.id,
        status: "ACTIVE",
        endsAt: { gt: new Date() },
      },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "An active session already exists for this course",
          sessionId: existing.id,
        },
        { status: 409 }
      );
    }

    const startedAt = new Date();
    const attendanceSession = await db.attendanceSession.create({
      data: {
        courseId: course.id,
        lecturerId: user.id,
        phase: parsed.phase,
        startedAt,
        endsAt: getDefaultSessionEndsAt(startedAt),
        qrRotationMs: QR_ROTATION_MS,
        qrGraceMs: QR_GRACE_MS,
        relayEnabled: parsed.enableBle,
        relayOpenTime: parsed.enableBle ? startedAt : null,
        qrSecret: generateQrSecret(),
      },
      include: { course: true },
    });

    if (parsed.enableBle) {
      const beaconName = buildDefaultBeaconName({
        courseCode: course.code,
        sessionId: attendanceSession.id,
        phase: parsed.phase,
      });

      await setSessionBleBroadcast(attendanceSession.id, {
        lecturerId: user.id,
        beaconName,
        startedAt,
        expiresAt: attendanceSession.endsAt,
      });
    }

    await Promise.all([
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:ACTIVE`),
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:ALL`),
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:CLOSED`),
    ]);

    const enrollmentRows = await db.enrollment.findMany({
      where: { courseId: course.id },
      select: { studentId: true },
    });
    await invalidateStudentSessionKeys(enrollmentRows.map((row) => row.studentId));

    return NextResponse.json(attendanceSession, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Create session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  const now = new Date();
  const statusFilter =
    new URL(request.url).searchParams.get("status")?.toUpperCase() || null;
  const effectiveStatusFilter =
    user.role === "STUDENT" && !statusFilter ? "ACTIVE" : statusFilter ?? "ALL";
  const cacheKey = `attendance:sessions:list:${user.role}:${user.id}:${effectiveStatusFilter}`;
  const cached = await cacheGet<any[]>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const whereBase =
    user.role === "LECTURER"
      ? { lecturerId: user.id }
      : user.role === "STUDENT"
        ? { course: { enrollments: { some: { studentId: user.id } } } }
        : {};

  const where: Record<string, unknown> = { ...whereBase };
  if (effectiveStatusFilter === "ACTIVE") {
    where.status = "ACTIVE";
    where.endsAt = { gt: now };
  } else if (effectiveStatusFilter === "CLOSED") {
    where.OR = [{ status: "CLOSED" }, { endsAt: { lte: now } }];
  }

  const sessions = await db.attendanceSession.findMany({
    where,
    include: {
      course: true,
      _count: { select: { records: true } },
      ...(user.role === "STUDENT"
        ? {
            records: {
              where: { studentId: user.id },
              select: {
                id: true,
                webauthnUsed: true,
                qrToken: true,
                bleSignalStrength: true,
              },
            },
          }
        : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  if (user.role === "STUDENT") {
    const phaseCompletionByCourseDay = new Map<string, Promise<any>>();
    const payload = await Promise.all(
      sessions.map(async (sessionRow) => {
        const { records, ...rest } = sessionRow as any;
        const derivedPhase = deriveAttendancePhase(
          {
            status: sessionRow.status,
            phase: sessionRow.phase,
            endsAt: sessionRow.endsAt,
          },
          now
        );
        const derivedStatus = derivedPhase === "CLOSED" ? "CLOSED" : sessionRow.status;
        const requestKey = [
          sessionRow.courseId,
          sessionRow.lecturerId,
          sessionRow.startedAt.toISOString().slice(0, 10),
        ].join(":");

        let phaseCompletionPromise = phaseCompletionByCourseDay.get(requestKey);
        if (!phaseCompletionPromise) {
          phaseCompletionPromise = getStudentPhaseCompletionForCourseDay({
            studentId: user.id,
            courseId: sessionRow.courseId,
            lecturerId: sessionRow.lecturerId,
            referenceTime: sessionRow.startedAt,
          });
          phaseCompletionByCourseDay.set(requestKey, phaseCompletionPromise);
        }
        const phaseCompletion = await phaseCompletionPromise;

        const canMarkPhase =
          derivedPhase !== "PHASE_TWO" || phaseCompletion.phaseOneDone;

        return {
          ...rest,
          status: derivedStatus,
          phase: derivedPhase,
          hasMarked: Array.isArray(records) && records.length > 0,
          layers:
            Array.isArray(records) && records.length > 0
              ? {
                  webauthn: Boolean(records[0]?.webauthnUsed),
                  qr:
                    typeof records[0]?.qrToken === "string" &&
                    records[0].qrToken.length > 0,
                  ble: records[0]?.bleSignalStrength != null,
                }
              : undefined,
          canMarkPhase,
          blockReason: canMarkPhase
            ? null
            : "Complete Phase 1 for this class before marking Phase 2.",
          phaseCompletion,
        };
      })
    );

    await cacheSet(cacheKey, payload, SESSION_LIST_CACHE_TTL_SECONDS);
    return NextResponse.json(payload);
  }

  const normalized = sessions.map((sessionRow) => {
    const derivedPhase = deriveAttendancePhase(
      {
        status: sessionRow.status,
        phase: sessionRow.phase,
        endsAt: sessionRow.endsAt,
      },
      now
    );

    return {
      ...sessionRow,
      status: derivedPhase === "CLOSED" ? "CLOSED" : sessionRow.status,
      phase: derivedPhase,
    };
  });

  await cacheSet(cacheKey, normalized as any, SESSION_LIST_CACHE_TTL_SECONDS);
  return NextResponse.json(normalized);
}
