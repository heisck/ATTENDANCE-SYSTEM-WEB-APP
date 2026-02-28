import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { courseRepAssignSchema } from "@/lib/validators";
import { isAdminLike, resolveOrganizationIdForStaff } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!isAdminLike(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedOrgId = new URL(request.url).searchParams.get("organizationId");
  const organizationId = resolveOrganizationIdForStaff(user, requestedOrgId);
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const scopes = await db.courseRepScope.findMany({
    where: { organizationId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      cohort: { select: { id: true, displayName: true } },
      course: { select: { id: true, code: true, name: true } },
      assignedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ scopes });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!isAdminLike(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = courseRepAssignSchema.parse(body);
    const email = parsed.email?.trim().toLowerCase();

    const organizationId = resolveOrganizationIdForStaff(user, body?.organizationId ?? null);
    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }

    const [targetUser, cohort, course] = await Promise.all([
      db.user.findFirst({
        where: parsed.userId
          ? { id: parsed.userId }
          : { email },
        select: { id: true, role: true, organizationId: true },
      }),
      parsed.cohortId
        ? db.cohort.findFirst({ where: { id: parsed.cohortId, organizationId }, select: { id: true } })
        : Promise.resolve(null),
      parsed.courseId
        ? db.course.findFirst({ where: { id: parsed.courseId, organizationId }, select: { id: true } })
        : Promise.resolve(null),
    ]);

    if (!targetUser || targetUser.organizationId !== organizationId) {
      return NextResponse.json({ error: "Target student not found" }, { status: 404 });
    }

    if (targetUser.role !== "STUDENT") {
      return NextResponse.json({ error: "Only students can be assigned as Course Rep" }, { status: 400 });
    }

    if (parsed.cohortId && !cohort) {
      return NextResponse.json({ error: "Cohort not found in organization" }, { status: 404 });
    }

    if (parsed.courseId && !course) {
      return NextResponse.json({ error: "Course not found in organization" }, { status: 404 });
    }

    const existingScope = await db.courseRepScope.findFirst({
      where: {
        userId: targetUser.id,
        organizationId,
        cohortId: parsed.cohortId || null,
        courseId: parsed.courseId || null,
      },
      select: { id: true },
    });

    const scope = existingScope
      ? await db.courseRepScope.update({
          where: { id: existingScope.id },
          data: {
            active: parsed.active,
            assignedByUserId: user.id,
          },
          include: {
            cohort: { select: { id: true, displayName: true } },
            course: { select: { id: true, code: true, name: true } },
          },
        })
      : await db.courseRepScope.create({
          data: {
            userId: targetUser.id,
            organizationId,
            cohortId: parsed.cohortId || null,
            courseId: parsed.courseId || null,
            active: parsed.active,
            assignedByUserId: user.id,
          },
          include: {
            cohort: { select: { id: true, displayName: true } },
            course: { select: { id: true, code: true, name: true } },
          },
        });

    return NextResponse.json({ scope });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Course rep assign error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
