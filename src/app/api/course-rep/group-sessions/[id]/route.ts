import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";
import { groupFormationSessionSchema } from "@/lib/validators";

const updateSchema = groupFormationSessionSchema.partial();

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await db.groupFormationSession.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      cohortId: true,
      courseId: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Group session not found" }, { status: 404 });
  }

  const permission = await canManageGroupSession(session.user as any, existing);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  try {
    const body = await request.json();
    const parsed = updateSchema.parse(body);

    const nextStartsAt = parsed.startsAt ? new Date(parsed.startsAt) : null;
    const nextEndsAt = parsed.endsAt ? new Date(parsed.endsAt) : null;
    if (nextStartsAt && nextEndsAt && nextStartsAt >= nextEndsAt) {
      return NextResponse.json({ error: "endsAt must be later than startsAt." }, { status: 400 });
    }

    const updated = await db.groupFormationSession.update({
      where: { id },
      data: {
        cohortId: parsed.cohortId ?? undefined,
        courseId: parsed.courseId ?? undefined,
        title: parsed.title?.trim() ?? undefined,
        groupSize: parsed.groupSize,
        mode: parsed.mode,
        leaderMode: parsed.leaderMode,
        startsAt: parsed.startsAt ? new Date(parsed.startsAt) : undefined,
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : undefined,
        active: parsed.active,
      },
      include: {
        cohort: { select: { id: true, displayName: true } },
        course: { select: { id: true, code: true, name: true } },
        groups: {
          include: { _count: { select: { memberships: true } }, link: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return NextResponse.json({ session: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError || error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Update group session error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await db.groupFormationSession.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      cohortId: true,
      courseId: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Group session not found" }, { status: 404 });
  }

  const permission = await canManageGroupSession(session.user as any, existing);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  await db.groupFormationSession.update({
    where: { id },
    data: { active: false },
  });

  return NextResponse.json({ success: true });
}

