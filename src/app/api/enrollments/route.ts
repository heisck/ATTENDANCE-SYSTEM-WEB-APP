import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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
        select: { id: true, name: true, email: true, studentId: true, indexNumber: true },
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

    if (!courseId || !Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json(
        { error: "courseId and studentIds[] are required" },
        { status: 400 }
      );
    }

    const access = await assertCourseAccess(user.id, user.role, courseId, user.organizationId);
    if (access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const results = await Promise.allSettled(
      studentIds.map((studentId: string) =>
        db.enrollment.upsert({
          where: { courseId_studentId: { courseId, studentId } },
          create: { courseId, studentId },
          update: {},
        })
      )
    );

    const created = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

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

  return NextResponse.json({ success: true });
}
