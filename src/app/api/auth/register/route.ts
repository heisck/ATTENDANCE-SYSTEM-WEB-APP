import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { registerSchema } from "@/lib/validators";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = registerSchema.parse(body);

    const normalizedEmail = parsed.email.trim().toLowerCase();
    const normalizedStudentId =
      parsed.role === "STUDENT" ? parsed.studentId?.trim() : undefined;
    const normalizedIndexNumber =
      parsed.role === "STUDENT" ? parsed.indexNumber?.trim() : undefined;

    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    if (normalizedStudentId) {
      const existingByStudentId = await db.user.findUnique({
        where: { studentId: normalizedStudentId },
      });
      if (existingByStudentId) {
        return NextResponse.json(
          { error: "An account with this Student ID already exists" },
          { status: 409 }
        );
      }
    }

    if (normalizedIndexNumber) {
      const existingByIndexNumber = await db.user.findUnique({
        where: { indexNumber: normalizedIndexNumber },
      });
      if (existingByIndexNumber) {
        return NextResponse.json(
          { error: "An account with this Index Number already exists" },
          { status: 409 }
        );
      }
    }

    const org = await db.organization.findUnique({
      where: { slug: parsed.organizationSlug },
    });
    if (!org) {
      return NextResponse.json(
        { error: "University not found. Check the organization code." },
        { status: 404 }
      );
    }

    const passwordHash = await hash(parsed.password, 10);

    const user = await db.user.create({
      data: {
        name: parsed.name,
        email: normalizedEmail,
        passwordHash,
        role: parsed.role,
        studentId: parsed.role === "STUDENT" ? normalizedStudentId : null,
        indexNumber: parsed.role === "STUDENT" ? normalizedIndexNumber : null,
        organizationId: org.id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }
    if (error?.code === "P2002" && Array.isArray(error?.meta?.target)) {
      const fields = error.meta.target as string[];
      if (fields.includes("email")) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }
      if (fields.includes("studentId")) {
        return NextResponse.json(
          { error: "An account with this Student ID already exists" },
          { status: 409 }
        );
      }
      if (fields.includes("indexNumber")) {
        return NextResponse.json(
          { error: "An account with this Index Number already exists" },
          { status: 409 }
        );
      }
    }
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
