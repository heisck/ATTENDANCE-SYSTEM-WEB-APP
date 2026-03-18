import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createCourseSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as {
    id: string;
    role: string;
    organizationId?: string | null;
  };

  if (user.role !== "LECTURER") {
    return NextResponse.json(
      { error: "Only lecturers can assign courses to themselves" },
      { status: 403 }
    );
  }

  if (!user.organizationId) {
    return NextResponse.json(
      { error: "You must belong to an organization before creating courses" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const parsed = createCourseSchema.parse(body);
    const normalizedCode = parsed.code.trim().toUpperCase();
    const normalizedName = parsed.name.trim();
    const normalizedDescription = parsed.description?.trim() || undefined;

    const existingCourse = await db.course.findFirst({
      where: {
        organizationId: user.organizationId,
        code: { equals: normalizedCode, mode: "insensitive" },
      },
      select: {
        id: true,
        lecturerId: true,
      },
    });

    if (existingCourse) {
      if (existingCourse.lecturerId === user.id) {
        return NextResponse.json(
          {
            error: "This course is already assigned to you.",
            courseId: existingCourse.id,
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          error:
            "This course code already exists in your organization. Contact your administrator if it should be reassigned.",
        },
        { status: 409 }
      );
    }

    const course = await db.course.create({
      data: {
        code: normalizedCode,
        name: normalizedName,
        description: normalizedDescription,
        organizationId: user.organizationId,
        lecturerId: user.id,
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
      },
    });

    return NextResponse.json(course, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }

    if (error?.code === "P2002") {
      return NextResponse.json(
        {
          error:
            "This course code already exists in your organization. Contact your administrator if it should be reassigned.",
        },
        { status: 409 }
      );
    }

    console.error("Lecturer self-assign course error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
