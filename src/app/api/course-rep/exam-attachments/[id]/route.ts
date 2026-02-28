import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/job-queue";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";

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
    return { ok: true as const };
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
  return { ok: true as const };
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
  const attachment = await db.examAttachment.findUnique({
    where: { id },
    include: {
      examEntry: {
        select: {
          id: true,
          organizationId: true,
          cohortId: true,
          courseId: true,
        },
      },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const permission = await canManageExam(session.user as any, attachment.examEntry);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  await db.examAttachment.delete({
    where: { id: attachment.id },
  });

  await enqueueJob({
    type: JobType.DELETE_CLOUDINARY_ASSET,
    payload: {
      publicId: attachment.publicId,
      resourceType: attachment.resourceType,
    },
    organizationId: attachment.examEntry.organizationId,
  });

  return NextResponse.json({ success: true });
}

