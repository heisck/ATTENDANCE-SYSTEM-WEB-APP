import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
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

    const course = await db.course.findFirst({
      where: { id: parsed.courseId, lecturerId: user.id },
    });
    if (!course) {
      return NextResponse.json({ error: "Course not found or not assigned to you" }, { status: 404 });
    }

    const existing = await db.attendanceSession.findFirst({
      where: { courseId: parsed.courseId, status: "ACTIVE" },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An active session already exists for this course", sessionId: existing.id },
        { status: 409 }
      );
    }

    const attendanceSession = await db.attendanceSession.create({
      data: {
        courseId: parsed.courseId,
        lecturerId: user.id,
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

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;

  const where =
    user.role === "LECTURER"
      ? { lecturerId: user.id }
      : user.role === "STUDENT"
        ? { course: { enrollments: { some: { studentId: user.id } } }, status: "ACTIVE" as const }
        : {};

  const sessions = await db.attendanceSession.findMany({
    where,
    include: {
      course: true,
      _count: { select: { records: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return NextResponse.json(sessions);
}
