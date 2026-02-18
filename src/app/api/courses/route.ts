import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;

  let courses;
  if (user.role === "LECTURER") {
    courses = await db.course.findMany({
      where: { lecturerId: user.id },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  } else if (user.role === "STUDENT") {
    courses = await db.course.findMany({
      where: { enrollments: { some: { studentId: user.id } } },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  } else if (user.role === "ADMIN" && user.organizationId) {
    courses = await db.course.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  } else {
    courses = await db.course.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  }

  return NextResponse.json(courses);
}
