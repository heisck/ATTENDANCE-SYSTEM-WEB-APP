import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
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

  await db.enrollment.delete({
    where: { courseId_studentId: { courseId, studentId } },
  });

  return NextResponse.json({ success: true });
}
