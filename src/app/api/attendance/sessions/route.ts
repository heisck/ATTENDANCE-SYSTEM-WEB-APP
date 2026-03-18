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

function getUtcDayRange(reference: Date) {
  const start = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

type SameDaySessionSummary = {
  totalSessionsToday: number;
  phaseOneSessionsToday: number;
  phaseTwoSessionsToday: number;
};

function buildPhaseStartConfirmation(
  phase: "PHASE_ONE" | "PHASE_TWO",
  summary: SameDaySessionSummary
) {
  if (phase === "PHASE_ONE") {
    if (summary.phaseOneSessionsToday > 0) {
      return {
        message:
          summary.phaseOneSessionsToday === 1
            ? "Phase 1 has already been opened once for this class today. Start a Phase 1 extension for students who missed it?"
            : `Phase 1 has already been opened ${summary.phaseOneSessionsToday} times for this class today. Start another Phase 1 extension?`,
        kind: "PHASE_ONE_EXTENSION" as const,
      };
    }

    if (summary.phaseTwoSessionsToday > 0) {
      return {
        message:
          "Phase 2 has already been used for this class today. Start another Phase 1 session anyway?",
        kind: "PHASE_ONE_AFTER_PHASE_TWO" as const,
      };
    }

    return null;
  }

  if (summary.phaseTwoSessionsToday > 0) {
    return {
      message:
        summary.phaseTwoSessionsToday === 1
          ? "Phase 2 has already been opened once for this class today. Start a Phase 2 extension for students who still need the closing mark?"
          : `Phase 2 has already been opened ${summary.phaseTwoSessionsToday} times for this class today. Start another Phase 2 extension?`,
      kind: "PHASE_TWO_EXTENSION" as const,
    };
  }

  if (summary.phaseOneSessionsToday > 0) {
    return {
      message:
        "Phase 1 already exists for this class today. Start Phase 2 now as the closing session for this class?",
      kind: "PHASE_TWO_CLOSING" as const,
    };
  }

  return {
    message:
      "No Phase 1 session has been recorded for this class today. Start Phase 2 anyway?",
    kind: "PHASE_TWO_WITHOUT_PHASE_ONE" as const,
  };
}

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
    const { start, end } = getUtcDayRange(startedAt);
    const sameDaySessions = await db.attendanceSession.findMany({
      where: {
        courseId: course.id,
        startedAt: {
          gte: start,
          lt: end,
        },
      },
      select: {
        id: true,
        phase: true,
        startedAt: true,
      },
      orderBy: { startedAt: "asc" },
    });

    const sameDaySummary: SameDaySessionSummary = {
      totalSessionsToday: sameDaySessions.length,
      phaseOneSessionsToday: sameDaySessions.filter((row) => row.phase === "PHASE_ONE")
        .length,
      phaseTwoSessionsToday: sameDaySessions.filter((row) => row.phase === "PHASE_TWO")
        .length,
    };

    const confirmation = buildPhaseStartConfirmation(parsed.phase, sameDaySummary);
    if (confirmation && !parsed.confirmStart) {
      return NextResponse.json(
        {
          error: confirmation.message,
          needsConfirmation: true,
          confirmationKind: confirmation.kind,
          summary: sameDaySummary,
        },
        { status: 409 }
      );
    }

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
        let canMarkPhase = true;
        let blockReason: string | null = null;

        if (derivedPhase === "PHASE_ONE" && phaseCompletion.phaseOneDone) {
          canMarkPhase = false;
          blockReason =
            "You already completed Phase 1 for this class. Wait for Phase 2.";
        } else if (derivedPhase === "PHASE_TWO" && !phaseCompletion.phaseOneDone) {
          canMarkPhase = false;
          blockReason =
            "Complete Phase 1 for this class before marking Phase 2.";
        } else if (derivedPhase === "PHASE_TWO" && phaseCompletion.phaseTwoDone) {
          canMarkPhase = false;
          blockReason =
            "You already completed Phase 2 for this class.";
        }

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
          blockReason,
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
