import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  deriveAttendancePhase,
  getDefaultSessionEndsAt,
  normalizeSessionDurationMinutes,
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
import {
  getHistoricalPhaseFromSession,
  getPhaseForSessionFlow,
  resolveSessionFamilyKey,
} from "@/lib/session-flow";

const SESSION_LIST_CACHE_TTL_SECONDS = 10;
const DEFAULT_SESSION_LIST_TAKE = 20;
const MAX_SESSION_LIST_TAKE = 100;

function normalizeTake(value: string | null) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_LIST_TAKE;
  }

  return Math.min(MAX_SESSION_LIST_TAKE, parsed);
}

function buildLinkedSessionError(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

async function invalidateStudentSessionKeys(studentIds: string[]) {
  await Promise.all(
    studentIds.map((studentId) =>
      Promise.all([
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ACTIVE:${DEFAULT_SESSION_LIST_TAKE}`),
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ALL:${DEFAULT_SESSION_LIST_TAKE}`),
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:CLOSED:${DEFAULT_SESSION_LIST_TAKE}`),
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ACTIVE:${MAX_SESSION_LIST_TAKE}`),
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ALL:${MAX_SESSION_LIST_TAKE}`),
        cacheDel(`attendance:sessions:list:STUDENT:${studentId}:CLOSED:${MAX_SESSION_LIST_TAKE}`),
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

  const user = session.user as { id: string; role: string };
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
    const durationMinutes = normalizeSessionDurationMinutes(parsed.durationMinutes);

    const sessionFlow = parsed.sessionFlow;
    const phase = getPhaseForSessionFlow(sessionFlow);
    const startedAt = new Date();

    const attendanceSession = await db.$transaction(
      async (tx) => {
        const course = await tx.course.findFirst({
          where: {
            code: { equals: normalizedCourseCode, mode: "insensitive" },
            lecturerId: user.id,
          },
        });
        if (!course) {
          throw new Error("COURSE_NOT_FOUND");
        }

        const existing = await tx.attendanceSession.findFirst({
          where: {
            courseId: course.id,
            status: "ACTIVE",
            endsAt: { gt: startedAt },
          },
        });
        if (existing) {
          throw new Error(`ACTIVE_SESSION_EXISTS:${existing.id}`);
        }

        let sessionFamilyId: string = randomUUID();
        let linkedSessionId: string | null = null;

        if (sessionFlow !== "NEW_SESSION") {
          const linkedSession = await tx.attendanceSession.findUnique({
            where: { id: parsed.linkedSessionId! },
            select: {
              id: true,
              courseId: true,
              lecturerId: true,
              sessionFamilyId: true,
            },
          });

          if (!linkedSession) {
            throw new Error("LINKED_SESSION_NOT_FOUND");
          }

          if (linkedSession.courseId !== course.id || linkedSession.lecturerId !== user.id) {
            throw new Error("LINKED_SESSION_FORBIDDEN");
          }

          sessionFamilyId =
            linkedSession.sessionFamilyId?.trim() || linkedSession.id;
          linkedSessionId = linkedSession.id;

          if (!linkedSession.sessionFamilyId) {
            await tx.attendanceSession.update({
              where: { id: linkedSession.id },
              data: {
                sessionFamilyId,
              },
            });
          }

          const familySessions = await tx.attendanceSession.findMany({
            where: {
              courseId: course.id,
              lecturerId: user.id,
              OR: [{ sessionFamilyId }, { id: linkedSession.id }],
            },
            select: {
              id: true,
              phase: true,
              sessionFlow: true,
              startedAt: true,
            },
            orderBy: { startedAt: "asc" },
          });

          const phaseOneSessions = familySessions.filter(
            (row) =>
              getHistoricalPhaseFromSession({
                sessionFlow: row.sessionFlow,
                phase: row.phase,
              }) === "PHASE_ONE"
          ).length;
          const phaseTwoSessions = familySessions.filter(
            (row) =>
              getHistoricalPhaseFromSession({
                sessionFlow: row.sessionFlow,
                phase: row.phase,
              }) === "PHASE_TWO"
          ).length;

          if (sessionFlow === "PHASE_ONE_FOLLOW_UP") {
            if (phaseOneSessions === 0) {
              throw new Error("LINKED_SESSION_PHASE_ONE_MISSING");
            }

            if (phaseTwoSessions > 0) {
              throw new Error("LINKED_SESSION_PHASE_TWO_ALREADY_STARTED");
            }
          }

          if (sessionFlow === "PHASE_TWO_CLOSING") {
            if (phaseOneSessions === 0) {
              throw new Error("LINKED_SESSION_PHASE_ONE_REQUIRED");
            }

            if (phaseTwoSessions > 0) {
              throw new Error("LINKED_SESSION_PHASE_TWO_ALREADY_OPEN");
            }
          }

          if (sessionFlow === "PHASE_TWO_FOLLOW_UP") {
            if (phaseOneSessions === 0) {
              throw new Error("LINKED_SESSION_PHASE_ONE_REOPEN_REQUIRED");
            }

            if (phaseTwoSessions === 0) {
              throw new Error("LINKED_SESSION_PHASE_TWO_FIRST_REQUIRED");
            }
          }
        }

        return tx.attendanceSession.create({
          data: {
            courseId: course.id,
            lecturerId: user.id,
            phase,
            sessionFlow,
            sessionFamilyId,
            linkedSessionId,
            durationMinutes,
            startedAt,
            endsAt: getDefaultSessionEndsAt(startedAt, durationMinutes),
            qrRotationMs: QR_ROTATION_MS,
            qrGraceMs: QR_GRACE_MS,
            relayEnabled: parsed.enableBle,
            relayOpenTime: parsed.enableBle ? startedAt : null,
            qrSecret: generateQrSecret(),
          },
          include: { course: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if (parsed.enableBle) {
      const beaconName = buildDefaultBeaconName({
        courseCode: attendanceSession.course.code,
        sessionId: attendanceSession.id,
        phase,
      });

      await setSessionBleBroadcast(attendanceSession.id, {
        lecturerId: user.id,
        beaconName,
        startedAt,
        expiresAt: attendanceSession.endsAt,
      });
    }

    await Promise.all([
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:ACTIVE:${DEFAULT_SESSION_LIST_TAKE}`),
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:ALL:${DEFAULT_SESSION_LIST_TAKE}`),
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:CLOSED:${DEFAULT_SESSION_LIST_TAKE}`),
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:ACTIVE:${MAX_SESSION_LIST_TAKE}`),
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:ALL:${MAX_SESSION_LIST_TAKE}`),
      cacheDel(`attendance:sessions:list:LECTURER:${user.id}:CLOSED:${MAX_SESSION_LIST_TAKE}`),
    ]);

    const enrollmentRows = await db.enrollment.findMany({
      where: { courseId: attendanceSession.courseId },
      select: { studentId: true },
    });
    await invalidateStudentSessionKeys(enrollmentRows.map((row) => row.studentId));

    return NextResponse.json(attendanceSession, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    if (error?.message === "COURSE_NOT_FOUND") {
      return NextResponse.json(
        { error: "Course code not found or not assigned to you" },
        { status: 404 }
      );
    }
    if (typeof error?.message === "string" && error.message.startsWith("ACTIVE_SESSION_EXISTS:")) {
      return NextResponse.json(
        {
          error: "An active session already exists for this course",
          sessionId: error.message.split(":")[1] || undefined,
        },
        { status: 409 }
      );
    }
    if (error?.message === "LINKED_SESSION_NOT_FOUND") {
      return NextResponse.json(
        { error: "The earlier session you selected was not found." },
        { status: 404 }
      );
    }
    if (error?.message === "LINKED_SESSION_FORBIDDEN") {
      return NextResponse.json(
        { error: "You can only continue sessions for your own course." },
        { status: 403 }
      );
    }
    if (error?.message === "LINKED_SESSION_PHASE_ONE_MISSING") {
      return buildLinkedSessionError(
        "This class session has no Phase 1 to continue yet."
      );
    }
    if (error?.message === "LINKED_SESSION_PHASE_TWO_ALREADY_STARTED") {
      return buildLinkedSessionError(
        "Phase 2 has already started for this class session. Start a new class session instead."
      );
    }
    if (error?.message === "LINKED_SESSION_PHASE_ONE_REQUIRED") {
      return buildLinkedSessionError(
        "Start Phase 1 before opening Phase 2 for this class session."
      );
    }
    if (error?.message === "LINKED_SESSION_PHASE_TWO_ALREADY_OPEN") {
      return buildLinkedSessionError(
        "Phase 2 is already open for this class session. Use Phase 2 follow-up instead."
      );
    }
    if (error?.message === "LINKED_SESSION_PHASE_ONE_REOPEN_REQUIRED") {
      return buildLinkedSessionError(
        "Start Phase 1 before reopening Phase 2 for this class session."
      );
    }
    if (error?.message === "LINKED_SESSION_PHASE_TWO_FIRST_REQUIRED") {
      return buildLinkedSessionError(
        "Start the first Phase 2 closing session before opening a Phase 2 follow-up."
      );
    }
    if (error?.code === "P2034") {
      return NextResponse.json(
        { error: "A session update conflict occurred. Please retry once." },
        { status: 409 }
      );
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

  const user = session.user as { id: string; role: string };
  const now = new Date();
  const statusFilter =
    new URL(request.url).searchParams.get("status")?.toUpperCase() || null;
  const take = normalizeTake(new URL(request.url).searchParams.get("take"));
  const effectiveStatusFilter =
    user.role === "STUDENT" && !statusFilter ? "ACTIVE" : statusFilter ?? "ALL";
  const cacheKey = `attendance:sessions:list:${user.role}:${user.id}:${effectiveStatusFilter}:${take}`;
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
    take,
  });

  if (user.role === "STUDENT") {
    const phaseCompletionByFamily = new Map<string, Promise<any>>();
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
        const requestKey = resolveSessionFamilyKey({
          sessionFamilyId: sessionRow.sessionFamilyId,
          courseId: sessionRow.courseId,
          lecturerId: sessionRow.lecturerId,
          startedAt: sessionRow.startedAt,
        });

        let phaseCompletionPromise = phaseCompletionByFamily.get(requestKey);
        if (!phaseCompletionPromise) {
          phaseCompletionPromise = getStudentPhaseCompletionForCourseDay({
            studentId: user.id,
            sessionFamilyId: sessionRow.sessionFamilyId,
            courseId: sessionRow.courseId,
            lecturerId: sessionRow.lecturerId,
            referenceTime: sessionRow.startedAt,
          });
          phaseCompletionByFamily.set(requestKey, phaseCompletionPromise);
        }
        const phaseCompletion = await phaseCompletionPromise;
        let canMarkPhase = true;
        let blockReason: string | null = null;

        if (derivedPhase === "PHASE_ONE" && phaseCompletion.phaseOneDone) {
          canMarkPhase = false;
          blockReason =
            "You already completed Phase 1 for this class session. Wait for Phase 2.";
        } else if (derivedPhase === "PHASE_TWO" && !phaseCompletion.phaseOneDone) {
          canMarkPhase = false;
          blockReason =
            "Complete Phase 1 for this class session before marking Phase 2.";
        } else if (derivedPhase === "PHASE_TWO" && phaseCompletion.phaseTwoDone) {
          canMarkPhase = false;
          blockReason =
            "You already completed Phase 2 for this class session.";
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
