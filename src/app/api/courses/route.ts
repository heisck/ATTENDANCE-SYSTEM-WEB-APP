import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  const searchParams = new URL(request.url).searchParams;
  const q = searchParams.get("q") || "";
  const take = Math.min(Math.max(1, parseInt(searchParams.get("take") || "500", 10)), 2000);
  const skip = Math.max(0, parseInt(searchParams.get("skip") || "0", 10));

  const baseWhere: any = {};
  if (q.trim()) {
    baseWhere.OR = [
      { code: { contains: q.trim(), mode: "insensitive" } },
      { name: { contains: q.trim(), mode: "insensitive" } },
    ];
  }

  let courses;
  if (user.role === "LECTURER") {
    courses = await db.course.findMany({
      where: { ...baseWhere, lecturerId: user.id },
      take,
      skip,
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  } else if (user.role === "STUDENT") {
    courses = await db.course.findMany({
      where: { ...baseWhere, enrollments: { some: { studentId: user.id } } },
      take,
      skip,
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  } else if (user.role === "ADMIN" && user.organizationId) {
    courses = await db.course.findMany({
      where: { ...baseWhere, organizationId: user.organizationId },
      take,
      skip,
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  } else {
    courses = await db.course.findMany({
      where: baseWhere,
      take,
      skip,
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    });
  }

  return NextResponse.json(courses);
}
