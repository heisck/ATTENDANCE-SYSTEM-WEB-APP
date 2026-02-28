import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";
import { createStudentGroupSchema } from "@/lib/validators";

async function canManageGroupSession(
  sessionUser: any,
  row: { organizationId: string; cohortId: string | null; courseId: string | null }
) {
  if (isAdminLike(sessionUser.role)) {
    if (sessionUser.role === "ADMIN" && sessionUser.organizationId !== row.organizationId) {
      return { ok: false as const, status: 403, error: "Forbidden" };
    }
    const org = await db.organization.findUnique({
      where: { id: row.organizationId },
      select: { settings: true },
    });
    if (!org) return { ok: false as const, status: 404, error: "Organization not found" };
    const flags = getFeatureFlags(org.settings);
    if (!flags.studentHubCore || !flags.groupFormation) {
      return { ok: false as const, status: 403, error: "groupFormation feature is disabled" };
    }
    return { ok: true as const };
  }

  const rep = await getStudentRepContext(sessionUser.id);
  if (!rep || !rep.isCourseRep || rep.user.organizationId !== row.organizationId) {
    return { ok: false as const, status: 403, error: "Course Rep access required" };
  }
  if (!rep.featureFlags.studentHubCore || !rep.featureFlags.groupFormation) {
    return { ok: false as const, status: 403, error: "groupFormation feature is disabled" };
  }
  const allowed = hasMatchingScope(rep.scopes, {
    cohortId: row.cohortId,
    courseId: row.courseId,
  });
  if (!allowed) {
    return { ok: false as const, status: 403, error: "Scope mismatch for group session" };
  }
  return { ok: true as const };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const sessionRow = await db.groupFormationSession.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      cohortId: true,
      courseId: true,
      groupSize: true,
    },
  });
  if (!sessionRow) {
    return NextResponse.json({ error: "Group session not found" }, { status: 404 });
  }

  const permission = await canManageGroupSession(session.user as any, sessionRow);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  try {
    const body = await request.json();
    const parsed = createStudentGroupSchema.parse(body);

    const group = await db.studentGroup.create({
      data: {
        sessionId: sessionRow.id,
        name: parsed.name.trim(),
        capacity: parsed.capacity ?? sessionRow.groupSize,
      },
      include: {
        _count: { select: { memberships: true } },
      },
    });

    return NextResponse.json({ group }, { status: 201 });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Create session group error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

