import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAttendanceReport,
  getAttendanceSessionReport,
} from "@/services/attendance.service";

type StaffUser = {
  id: string;
  role: string;
  organizationId?: string | null;
};

function canAccessCourse(user: StaffUser, input: {
  lecturerId: string;
  organizationId: string;
}) {
  if (!["LECTURER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return false;
  }

  if (user.role === "LECTURER") {
    return input.lecturerId === user.id;
  }

  if (user.role === "ADMIN") {
    return Boolean(user.organizationId) && user.organizationId === input.organizationId;
  }

  return true;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as StaffUser;
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId");
  const sessionId = searchParams.get("sessionId");

  if (!courseId && !sessionId) {
    return NextResponse.json(
      { error: "courseId or sessionId is required" },
      { status: 400 }
    );
  }

  if (sessionId) {
    const sessionAccess = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      select: {
        lecturerId: true,
        course: {
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!sessionAccess) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (
      !canAccessCourse(user, {
        lecturerId: sessionAccess.lecturerId,
        organizationId: sessionAccess.course.organizationId,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const report = await getAttendanceSessionReport(sessionId);
    if (!report) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json(report);
  }

  const courseAccess = await db.course.findUnique({
    where: { id: courseId! },
    select: {
      lecturerId: true,
      organizationId: true,
    },
  });

  if (!courseAccess) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  if (
    !canAccessCourse(user, {
      lecturerId: courseAccess.lecturerId,
      organizationId: courseAccess.organizationId,
    })
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const report = await getAttendanceReport(courseId!);
  if (!report) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  return NextResponse.json(report);
}
