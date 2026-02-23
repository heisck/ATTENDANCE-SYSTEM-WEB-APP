import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  INITIAL_PHASE_MS,
  TOTAL_SESSION_MS,
  getDefaultInitialEndsAt,
  getDefaultReverifyEndsAt,
  QR_GRACE_MS,
  QR_ROTATION_MS,
} from "@/lib/attendance";
import { generateQrSecret } from "@/lib/qr";
import { createSessionSchema } from "@/lib/validators";

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
        phase: "INITIAL",
        startedAt,
        initialEndsAt: getDefaultInitialEndsAt(startedAt),
        reverifyEndsAt: getDefaultReverifyEndsAt(startedAt),
        qrRotationMs: QR_ROTATION_MS,
        qrGraceMs: QR_GRACE_MS,
        gpsLat: parsed.gpsLat,
        gpsLng: parsed.gpsLng,
        radiusMeters: parsed.radiusMeters,
        qrSecret: generateQrSecret(),
      },
      include: { course: true },
    });

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

  await db.attendanceSession.updateMany({
    where: {
      status: "ACTIVE",
      startedAt: { lt: new Date(now.getTime() - TOTAL_SESSION_MS) },
    },
    data: {
      status: "CLOSED",
      phase: "CLOSED",
      closedAt: now,
    },
  });

  await db.attendanceSession.updateMany({
    where: {
      status: "ACTIVE",
      phase: "INITIAL",
      startedAt: {
        lte: new Date(now.getTime() - INITIAL_PHASE_MS),
        gt: new Date(now.getTime() - TOTAL_SESSION_MS),
      },
    },
    data: {
      phase: "REVERIFY",
    },
  });

  const where =
    user.role === "LECTURER"
      ? { lecturerId: user.id }
      : user.role === "STUDENT"
        ? { course: { enrollments: { some: { studentId: user.id } } }, status: "ACTIVE" as const }
        : {};

  const statusFilter = new URL(request.url).searchParams.get("status")?.toUpperCase() || null;
  const whereWithStatus: any = { ...where };
  if (statusFilter === "ACTIVE" || statusFilter === "CLOSED") {
    whereWithStatus.status = statusFilter;
  }

  const sessions = await db.attendanceSession.findMany({
    where: whereWithStatus,
    include: {
      course: true,
      _count: { select: { records: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return NextResponse.json(sessions);
}
