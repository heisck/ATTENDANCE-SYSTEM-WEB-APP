import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const formation = await db.groupFormationSession.findUnique({
    where: { id },
    include: {
      groups: {
        include: {
          _count: { select: { memberships: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!formation) {
    return NextResponse.json({ error: "Group session not found" }, { status: 404 });
  }
  if (formation.mode !== "RANDOM_ASSIGNMENT") {
    return NextResponse.json({ error: "Auto-assign is only available in RANDOM_ASSIGNMENT mode" }, { status: 400 });
  }

  const permission = await canManageGroupSession(session.user as any, formation);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  const targetStudents = await db.user.findMany({
    where: {
      role: "STUDENT",
      organizationId: formation.organizationId,
      ...(formation.cohortId ? { cohortId: formation.cohortId } : {}),
      ...(formation.courseId
        ? {
            enrollments: {
              some: { courseId: formation.courseId },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  const existingMemberships = await db.groupMembership.findMany({
    where: {
      group: {
        sessionId: formation.id,
      },
    },
    select: { studentId: true, groupId: true },
  });

  const assignedStudentIds = new Set(existingMemberships.map((row) => row.studentId));
  const unassignedStudents = targetStudents.filter((row) => !assignedStudentIds.has(row.id));

  if (unassignedStudents.length === 0) {
    return NextResponse.json({
      success: true,
      assigned: 0,
      message: "All target students are already assigned.",
    });
  }

  let groups = formation.groups;
  if (groups.length === 0) {
    const requiredGroups = Math.max(1, Math.ceil(targetStudents.length / formation.groupSize));
    const created = [];
    for (let i = 0; i < requiredGroups; i += 1) {
      const row = await db.studentGroup.create({
        data: {
          sessionId: formation.id,
          name: `Group ${i + 1}`,
          capacity: formation.groupSize,
        },
        include: {
          _count: { select: { memberships: true } },
        },
      });
      created.push(row);
    }
    groups = created;
  }

  const availableSlots = groups.map((group) => ({
    id: group.id,
    remaining: Math.max(group.capacity - group._count.memberships, 0),
  }));
  const hasSlot = () => availableSlots.some((slot) => slot.remaining > 0);
  if (!hasSlot()) {
    return NextResponse.json({ error: "No available group slots for assignment." }, { status: 400 });
  }

  const shuffled = shuffleArray(unassignedStudents);
  let assigned = 0;
  let cursor = 0;

  for (const student of shuffled) {
    let attempts = 0;
    while (attempts < availableSlots.length && availableSlots[cursor].remaining <= 0) {
      cursor = (cursor + 1) % availableSlots.length;
      attempts += 1;
    }

    if (availableSlots[cursor].remaining <= 0) break;

    await db.groupMembership.create({
      data: {
        groupId: availableSlots[cursor].id,
        studentId: student.id,
      },
    });

    availableSlots[cursor].remaining -= 1;
    assigned += 1;
    cursor = (cursor + 1) % availableSlots.length;
  }

  return NextResponse.json({
    success: true,
    assigned,
    totalCandidates: unassignedStudents.length,
  });
}

