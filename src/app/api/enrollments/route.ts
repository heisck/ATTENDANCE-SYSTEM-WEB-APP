import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CACHE_KEYS, cacheDel } from "@/lib/cache";

async function assertCourseAccess(
  userId: string,
  role: string,
  courseId: string,
  orgId: string | null | undefined
) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { organizationId: true, lecturerId: true },
  });
  if (!course) return { error: "Course not found" as const, status: 404 as const };
  if (role === "LECTURER") {
    if (course.lecturerId !== userId) {
      return { error: "You can only manage enrollments for your own courses" as const, status: 403 as const };
    }
  } else if (role === "ADMIN" && orgId && course.organizationId !== orgId) {
    return { error: "Course not in your organization" as const, status: 403 as const };
  }
  return null;
}

async function invalidateEnrollmentCaches(courseId: string, studentIds: string[]) {
  if (studentIds.length === 0) {
    return;
  }

  const activeSessions = await db.attendanceSession.findMany({
    where: {
      courseId,
      status: "ACTIVE",
      endsAt: { gt: new Date() },
    },
    select: { id: true },
  });

  await Promise.all([
    cacheDel(CACHE_KEYS.COURSE_ENROLLMENTS(courseId)),
    ...studentIds.flatMap((studentId) => [
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ACTIVE`),
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ALL`),
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:CLOSED`),
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ACTIVE:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ALL:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:CLOSED:20`),
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ACTIVE:100`),
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:ALL:100`),
      cacheDel(`attendance:sessions:list:STUDENT:${studentId}:CLOSED:100`),
      cacheDel(`student:live-sessions:${studentId}`),
      ...activeSessions.flatMap((sessionRow) => [
        cacheDel(`attendance:enrollment:${sessionRow.id}:${studentId}`),
        cacheDel(`attendance:session-me:${sessionRow.id}:${studentId}`),
      ]),
    ]),
  ]);
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId?: string | null; role: string };
  if (!["ADMIN", "SUPER_ADMIN", "LECTURER"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId");
  if (!courseId) {
    return NextResponse.json({ error: "courseId is required" }, { status: 400 });
  }

  const access = await assertCourseAccess(user.id, user.role, courseId, user.organizationId);
  if (access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const enrollments = await db.enrollment.findMany({
    where: { courseId },
    include: {
      student: {
        select: {
          id: true,
          name: true,
          email: true,
          studentId: true,
          indexNumber: true,
          cohort: {
            select: {
              id: true,
              department: true,
              level: true,
              groupCode: true,
              displayName: true,
            },
          },
        },
      },
    },
    orderBy: { enrolledAt: "desc" },
  });

  return NextResponse.json(enrollments);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId?: string | null; role: string };
  if (!["ADMIN", "SUPER_ADMIN", "LECTURER"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { courseId, studentIds } = await request.json();
    const uniqueStudentIds = Array.from(
      new Set(
        Array.isArray(studentIds)
          ? studentIds
              .filter((studentId) => typeof studentId === "string")
              .map((studentId) => studentId.trim())
              .filter((studentId) => studentId.length > 0)
          : []
      )
    );

    if (!courseId || uniqueStudentIds.length === 0) {
      return NextResponse.json(
        { error: "courseId and studentIds[] are required" },
        { status: 400 }
      );
    }

    const access = await assertCourseAccess(user.id, user.role, courseId, user.organizationId);
    if (access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const course = await db.course.findUnique({
      where: { id: courseId },
      select: { organizationId: true },
    });

    if (!course) {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }

    const validStudents = await db.user.findMany({
      where: {
        id: { in: uniqueStudentIds },
        role: "STUDENT",
        organizationId: course.organizationId,
      },
      select: { id: true },
    });

    if (validStudents.length !== uniqueStudentIds.length) {
      return NextResponse.json(
        { error: "One or more selected students are invalid for this course" },
        { status: 400 }
      );
    }

    const results = await Promise.allSettled(
      uniqueStudentIds.map((studentId) =>
        db.enrollment.upsert({
          where: { courseId_studentId: { courseId, studentId } },
          create: { courseId, studentId },
          update: {},
        })
      )
    );

    const created = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    await invalidateEnrollmentCaches(courseId, uniqueStudentIds);

    return NextResponse.json({ created, failed });
  } catch (error: any) {
    console.error("Enrollment error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN", "LECTURER"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId");
  const studentId = searchParams.get("studentId");

  if (!courseId || !studentId) {
    return NextResponse.json(
      { error: "courseId and studentId are required" },
      { status: 400 }
    );
  }

  const access = await assertCourseAccess(user.id, user.role, courseId, user.organizationId);
  if (access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  await db.enrollment.delete({
    where: { courseId_studentId: { courseId, studentId } },
  });

  await invalidateEnrollmentCaches(courseId, [studentId]);

  return NextResponse.json({ success: true });
}
