import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasMatchingScope } from "@/lib/course-rep";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { assignmentAnnouncementSchema } from "@/lib/validators";
import { enqueueManyJobs } from "@/lib/job-queue";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentRepContext(session.user.id);
  if (!context || !context.isCourseRep) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = assignmentAnnouncementSchema.parse(body);

    const existing = await db.assignmentAnnouncement.findFirst({
      where: {
        id,
        organizationId: context.user.organizationId!,
      },
      select: {
        id: true,
        cohortId: true,
        courseId: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Assignment announcement not found" }, { status: 404 });
    }

    const canEditExisting = hasMatchingScope(context.scopes, {
      cohortId: existing.cohortId,
      courseId: existing.courseId,
    });

    const canMoveToTarget = hasMatchingScope(context.scopes, {
      cohortId: parsed.cohortId || null,
      courseId: parsed.courseId || null,
    });

    if (!canEditExisting || !canMoveToTarget) {
      return NextResponse.json({ error: "Scope mismatch for this update" }, { status: 403 });
    }

    const announcement = await db.assignmentAnnouncement.update({
      where: { id },
      data: {
        cohortId: parsed.cohortId || null,
        courseId: parsed.courseId || null,
        title: parsed.title.trim(),
        body: parsed.body.trim(),
        dueAt: new Date(parsed.dueAt),
        submissionNote: parsed.submissionNote?.trim() || null,
        isGroupAssignment: parsed.isGroupAssignment,
      },
      include: {
        attachments: true,
      },
    });

    return NextResponse.json({ announcement });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Update assignment announcement error:", error);
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

  const context = await getStudentRepContext(session.user.id);
  if (!context || !context.isCourseRep) {
    return NextResponse.json({ error: "Course Rep access required" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await db.assignmentAnnouncement.findFirst({
    where: {
      id,
      organizationId: context.user.organizationId!,
    },
    include: {
      attachments: {
        select: {
          id: true,
          publicId: true,
          resourceType: true,
        },
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Assignment announcement not found" }, { status: 404 });
  }

  const allowed = hasMatchingScope(context.scopes, {
    cohortId: existing.cohortId,
    courseId: existing.courseId,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Scope mismatch for this delete" }, { status: 403 });
  }

  await db.assignmentAnnouncement.delete({
    where: { id },
  });

  await enqueueManyJobs(
    existing.attachments.map((attachment) => ({
      type: JobType.DELETE_CLOUDINARY_ASSET,
      payload: {
        publicId: attachment.publicId,
        resourceType: attachment.resourceType,
      },
      organizationId: context.user.organizationId!,
    }))
  );

  return NextResponse.json({ success: true });
}