import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasMatchingScope } from "@/lib/course-rep";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { createCloudinarySignedUpload } from "@/lib/cloudinary";
import {
  assignmentAttachmentFinalizeSchema,
  assignmentAttachmentInitSchema,
} from "@/lib/validators";

function normalizeFileStem(fileName: string) {
  const stem = fileName.includes(".")
    ? fileName.slice(0, fileName.lastIndexOf("."))
    : fileName;
  const cleaned = stem
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "file";
}

function matchesAnnouncementNamespace(publicId: string, organizationId: string, announcementId: string) {
  const namespace = `assignments/${organizationId}/${announcementId}/`;
  return publicId === namespace.slice(0, -1) || publicId.includes(namespace);
}

export async function POST(
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

  const { id: announcementId } = await params;

  const announcement = await db.assignmentAnnouncement.findFirst({
    where: {
      id: announcementId,
      organizationId: context.user.organizationId!,
    },
    select: {
      id: true,
      cohortId: true,
      courseId: true,
    },
  });

  if (!announcement) {
    return NextResponse.json({ error: "Assignment announcement not found" }, { status: 404 });
  }

  const allowed = hasMatchingScope(context.scopes, {
    cohortId: announcement.cohortId,
    courseId: announcement.courseId,
  });
  if (!allowed) {
    return NextResponse.json({ error: "Scope mismatch for this assignment" }, { status: 403 });
  }

  try {
    const body = await request.json();

    if (body?.action === "complete") {
      const parsed = assignmentAttachmentFinalizeSchema.parse(body);

      if (
        !matchesAnnouncementNamespace(
          parsed.publicId,
          context.user.organizationId!,
          announcementId
        )
      ) {
        return NextResponse.json(
          { error: "Attachment publicId does not match assignment namespace" },
          { status: 400 }
        );
      }

      const existing = await db.assignmentAttachment.findUnique({
        where: { publicId: parsed.publicId },
      });

      if (existing) {
        return NextResponse.json({ attachment: existing });
      }

      const attachment = await db.assignmentAttachment.create({
        data: {
          announcementId,
          publicId: parsed.publicId,
          resourceType: parsed.resourceType,
          url: parsed.url,
          fileName: parsed.fileName,
          bytes: parsed.bytes,
          mime: parsed.mime,
        },
      });

      return NextResponse.json({ attachment }, { status: 201 });
    }

    const parsed = assignmentAttachmentInitSchema.parse(body);
    const fileStem = normalizeFileStem(parsed.fileName);
    const publicId = `${Date.now()}-${fileStem}-${randomUUID().slice(0, 8)}`;
    const folder = `assignments/${context.user.organizationId}/${announcementId}`;

    const upload = createCloudinarySignedUpload({
      publicId,
      folder,
      resourceType: parsed.resourceType,
    });

    return NextResponse.json({
      upload,
      attachmentHint: {
        fileName: parsed.fileName,
        bytes: parsed.bytes,
        mime: parsed.mime,
      },
      message: "Upload to Cloudinary with this signed contract, then call action=complete.",
    });
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: error?.issues?.[0]?.message || error?.errors?.[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }

    console.error("Assignment attachment route error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
