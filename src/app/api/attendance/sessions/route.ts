import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  INITIAL_PHASE_MS,
  REVERIFY_PHASE_MS,
  getDefaultInitialEndsAt,
  getDefaultReverifyEndsAt,
  QR_GRACE_MS,
  QR_ROTATION_MS,
} from "@/lib/attendance";
import { generateQrSecret } from "@/lib/qr";
import { createSessionSchema } from "@/lib/validators";
import { cacheDel, cacheGet, cacheSet } from "@/lib/cache";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "LECTURER") {
    return NextResponse.json({ error: "Only lecturers can create sessions" }, { status: 403 });
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
      where: { courseId: course.id, status: "ACTIVE" },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An active session already exists for this course", sessionId: existing.id },
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
        initialEndsAt:
          parsed.phase === "INITIAL" ? getDefaultInitialEndsAt(startedAt) : null,
        reverifyEndsAt:
          parsed.phase === "REVERIFY" ? getDefaultReverifyEndsAt(startedAt) : null,
        qrRotationMs: QR_ROTATION_MS,
        qrGraceMs: QR_GRACE_MS,
        gpsLat: 0,
        gpsLng: 0,
        radiusMeters: 0,
        reverifySelectionDone: true,
        qrSecret: generateQrSecret(),
      },
      include: { course: true },
    });
    await cacheDel(`attendance:sessions:list:LECTURER:${user.id}:ACTIVE`);
    await cacheDel(`attendance:sessions:list:LECTURER:${user.id}:ALL`);
    await cacheDel(`attendance:sessions:list:LECTURER:${user.id}:CLOSED`);

    const enrollmentRows = await db.enrollment.findMany({
      where: { courseId: course.id },
      select: { studentId: true },
    });
    await Promise.all(
      enrollmentRows.map((row) =>
        Promise.all([
          cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ACTIVE`),
          cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:ALL`),
          cacheDel(`attendance:sessions:list:STUDENT:${row.studentId}:CLOSED`),
          cacheDel(`student:live-sessions:${row.studentId}`),
        ])
      )
    );

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
  const statusFilter = new URL(request.url).searchParams.get("status")?.toUpperCase() || null;
  const cacheKey = `attendance:sessions:list:${user.role}:${user.id}:${statusFilter ?? "ALL"}`;
  const cached = await cacheGet<any[]>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const now = new Date();
  await db.attendanceSession.updateMany({
    where: {
      status: "ACTIVE",
      OR: [
        {
          phase: "INITIAL",
          OR: [
            { initialEndsAt: { lte: now } },
            { initialEndsAt: null, startedAt: { lte: new Date(now.getTime() - INITIAL_PHASE_MS) } },
          ],
        },
        {
          phase: "REVERIFY",
          OR: [
            { reverifyEndsAt: { lte: now } },
            { reverifyEndsAt: null, startedAt: { lte: new Date(now.getTime() - REVERIFY_PHASE_MS) } },
          ],
        },
      ],
    },
    data: {
      status: "CLOSED",
      phase: "CLOSED",
      closedAt: now,
    },
  });

  const where =
    user.role === "LECTURER"
      ? { lecturerId: user.id }
      : user.role === "STUDENT"
        ? { course: { enrollments: { some: { studentId: user.id } } }, status: "ACTIVE" as const }
        : {};

  const whereWithStatus: any = { ...where };
  if (statusFilter === "ACTIVE" || statusFilter === "CLOSED") {
    whereWithStatus.status = statusFilter;
  }

  const sessions = await db.attendanceSession.findMany({
    where: whereWithStatus,
    include: {
      course: true,
      _count: { select: { records: true } },
      ...(user.role === "STUDENT"
        ? { records: { where: { studentId: user.id }, select: { id: true } } }
        : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  if (user.role === "STUDENT") {
    const payload = sessions.map((s) => {
      const { records, ...rest } = s as any;
      return { ...rest, hasMarked: Array.isArray(records) && records.length > 0 };
    });
    await cacheSet(cacheKey, payload, 2);
    return NextResponse.json(payload);
  }

  await cacheSet(cacheKey, sessions as any, 2);
  return NextResponse.json(sessions);
}
