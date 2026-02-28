import { NextRequest, NextResponse } from "next/server";
import { JobType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasMatchingScope } from "@/lib/course-rep";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { enqueueJob } from "@/lib/job-queue";

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

  const attachment = await db.assignmentAttachment.findUnique({
    where: { id },
    include: {
      announcement: {
        select: {
          id: true,
          organizationId: true,
          cohortId: true,
          courseId: true,
        },
      },
    },
  });

  if (!attachment || attachment.announcement.organizationId !== context.user.organizationId) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const allowed = hasMatchingScope(context.scopes, {
    cohortId: attachment.announcement.cohortId,
    courseId: attachment.announcement.courseId,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Scope mismatch for attachment delete" }, { status: 403 });
  }

  await db.assignmentAttachment.delete({
    where: { id: attachment.id },
  });

  await enqueueJob({
    type: JobType.DELETE_CLOUDINARY_ASSET,
    payload: {
      publicId: attachment.publicId,
      resourceType: attachment.resourceType,
    },
    organizationId: context.user.organizationId!,
  });

  return NextResponse.json({ success: true });
}

