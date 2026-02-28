import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";
import { enqueueManyJobs } from "@/lib/job-queue";
import { examEntryUpdateSchema } from "@/lib/validators";

async function canManageExam(sessionUser: any, exam: { organizationId: string; cohortId: string | null; courseId: string | null }) {
  if (isAdminLike(sessionUser.role)) {
    if (sessionUser.role === "ADMIN" && sessionUser.organizationId !== exam.organizationId) {
      return { ok: false as const, status: 403, error: "Forbidden" };
    }

    const org = await db.organization.findUnique({
      where: { id: exam.organizationId },
      select: { settings: true },
    });
    if (!org) return { ok: false as const, status: 404, error: "Organization not found" };
    const flags = getFeatureFlags(org.settings);
    if (!flags.studentHubCore || !flags.examHub) {
      return { ok: false as const, status: 403, error: "examHub feature is disabled" };
    }

    return { ok: true as const, userId: sessionUser.id };
  }

  const rep = await getStudentRepContext(sessionUser.id);
  if (!rep || !rep.isCourseRep || rep.user.organizationId !== exam.organizationId) {
    return { ok: false as const, status: 403, error: "Course Rep access required" };
  }
  if (!rep.featureFlags.studentHubCore || !rep.featureFlags.examHub) {
    return { ok: false as const, status: 403, error: "examHub feature is disabled" };
  }

  const allowed = hasMatchingScope(rep.scopes, {
    cohortId: exam.cohortId,
    courseId: exam.courseId,
  });
  if (!allowed) {
    return { ok: false as const, status: 403, error: "Scope mismatch for exam resource" };
  }

  return { ok: true as const, userId: rep.user.id };
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
  const existing = await db.examEntry.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      cohortId: true,
      courseId: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Exam entry not found" }, { status: 404 });
  }

  const permission = await canManageExam(session.user as any, existing);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  try {
    const body = await request.json();
    const parsed = examEntryUpdateSchema.parse(body);

    const nextCohortId = parsed.cohortId ?? existing.cohortId;
    const nextCourseId = parsed.courseId ?? existing.courseId;

    if (!nextCohortId && !nextCourseId) {
      return NextResponse.json({ error: "Provide cohortId or courseId target." }, { status: 400 });
    }

    const updated = await db.examEntry.update({
      where: { id },
      data: {
        cohortId: parsed.cohortId ?? undefined,
        courseId: parsed.courseId ?? undefined,
        title: parsed.title?.trim(),
        examDate: parsed.examDate ? new Date(parsed.examDate) : undefined,
        endAt: parsed.endAt ? new Date(parsed.endAt) : undefined,
        venue: parsed.venue?.trim() ?? undefined,
        allowAnyHall: parsed.allowAnyHall,
        instructions: parsed.instructions?.trim() ?? undefined,
      },
      include: {
        cohort: { select: { id: true, displayName: true } },
        course: { select: { id: true, code: true, name: true } },
        attachments: true,
        updates: { orderBy: { effectiveAt: "desc" }, take: 10 },
      },
    });

    return NextResponse.json({ exam: updated });
  } catch (error: any) {
    if (error instanceof z.ZodError || error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Update exam entry error:", error);
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
  const existing = await db.examEntry.findUnique({
    where: { id },
    include: {
      attachments: {
        select: {
          publicId: true,
          resourceType: true,
        },
      },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Exam entry not found" }, { status: 404 });
  }

  const permission = await canManageExam(session.user as any, existing);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  await db.examEntry.delete({
    where: { id },
  });

  await enqueueManyJobs(
    existing.attachments.map((attachment) => ({
      type: JobType.DELETE_CLOUDINARY_ASSET,
      payload: {
        publicId: attachment.publicId,
        resourceType: attachment.resourceType,
      },
      organizationId: existing.organizationId,
    }))
  );

  return NextResponse.json({ success: true });
}
