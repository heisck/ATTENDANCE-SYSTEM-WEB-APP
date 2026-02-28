import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFeatureFlags } from "@/lib/organization-settings";
import { isAdminLike } from "@/lib/permissions";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { hasMatchingScope } from "@/lib/course-rep";
import { createCloudinarySignedUpload } from "@/lib/cloudinary";
import { examAttachmentFinalizeSchema, examAttachmentInitSchema } from "@/lib/validators";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
]);

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

function matchesExamNamespace(publicId: string, organizationId: string, examId: string) {
  const namespace = `exams/${organizationId}/${examId}/`;
  return publicId === namespace.slice(0, -1) || publicId.includes(namespace);
}

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: examId } = await params;
  const exam = await db.examEntry.findUnique({
    where: { id: examId },
    select: {
      id: true,
      organizationId: true,
      cohortId: true,
      courseId: true,
    },
  });
  if (!exam) {
    return NextResponse.json({ error: "Exam entry not found" }, { status: 404 });
  }

  const permission = await canManageExam(session.user as any, exam);
  if (!permission.ok) {
    return NextResponse.json({ error: permission.error }, { status: permission.status });
  }

  try {
    const body = await request.json();

    if (body?.action === "complete") {
      const parsed = examAttachmentFinalizeSchema.parse(body);
      if (!matchesExamNamespace(parsed.publicId, exam.organizationId, examId)) {
        return NextResponse.json(
          { error: "Attachment publicId does not match exam namespace" },
          { status: 400 }
        );
      }

      const existing = await db.examAttachment.findUnique({
        where: { publicId: parsed.publicId },
      });
      if (existing) {
        return NextResponse.json({ attachment: existing });
      }

      const attachment = await db.examAttachment.create({
        data: {
          examEntryId: exam.id,
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

    const parsed = examAttachmentInitSchema.parse(body);
    if (parsed.bytes > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 20MB limit." },
        { status: 400 }
      );
    }
    if (!ALLOWED_MIME.has(parsed.mime.toLowerCase())) {
      return NextResponse.json(
        { error: "Only PDF files are allowed for exam attachments." },
        { status: 400 }
      );
    }

    const fileStem = normalizeFileStem(parsed.fileName);
    const publicId = `${Date.now()}-${fileStem}-${randomUUID().slice(0, 8)}`;
    const folder = `exams/${exam.organizationId}/${exam.id}`;

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
    console.error("Exam attachment route error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

