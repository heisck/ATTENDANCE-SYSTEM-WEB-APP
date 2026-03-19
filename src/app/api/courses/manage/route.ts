import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCourseSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createCourseSchema.parse(body);
    const requestedOrganizationId =
      user.role === "SUPER_ADMIN"
        ? typeof body.organizationId === "string" && body.organizationId.trim().length > 0
          ? body.organizationId.trim()
          : user.organizationId
        : user.organizationId;

    if (!body.lecturerId || !requestedOrganizationId) {
      return NextResponse.json(
        { error: "Lecturer and organization are required" },
        { status: 400 }
      );
    }

    const lecturer = await db.user.findFirst({
      where: {
        id: body.lecturerId,
        role: "LECTURER",
        organizationId: requestedOrganizationId,
      },
      select: { id: true },
    });

    if (!lecturer) {
      return NextResponse.json(
        { error: "Lecturer must exist in the target organization" },
        { status: 400 }
      );
    }

    const course = await db.course.create({
      data: {
        code: parsed.code,
        name: parsed.name,
        description: parsed.description,
        organizationId: requestedOrganizationId,
        lecturerId: body.lecturerId,
      },
    });

    return NextResponse.json(course, { status: 201 });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Course code already exists in this organization" },
        { status: 409 }
      );
    }
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Create course error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("id");
  const requestedOrganizationId =
    user.role === "SUPER_ADMIN"
      ? searchParams.get("organizationId")?.trim() || user.organizationId
      : user.organizationId;
  if (!courseId) {
    return NextResponse.json({ error: "Course ID required" }, { status: 400 });
  }
  if (!requestedOrganizationId) {
    return NextResponse.json({ error: "Organization is required" }, { status: 400 });
  }

  const deleted = await db.course.deleteMany({
    where: {
      id: courseId,
      organizationId: requestedOrganizationId,
    },
  });

  if (deleted.count !== 1) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
