import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStudentHubContext } from "@/lib/student-hub";
import { searchTextPdfFromUrl } from "@/lib/pdf-search";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getStudentHubContext(session.user.id);
  if (!context) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!context.organizationId) {
    return NextResponse.json({ error: "No organization context" }, { status: 400 });
  }
  if (!context.featureFlags.studentHubCore || !context.featureFlags.examHub) {
    return NextResponse.json({ error: "examHub feature is disabled" }, { status: 404 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  if (!query) {
    return NextResponse.json({ error: "Query parameter q is required" }, { status: 400 });
  }

  const { id } = await params;

  const scopeFilters: Array<Record<string, any>> = [];
  if (context.cohortId) {
    scopeFilters.push({ cohortId: context.cohortId });
  }
  if (context.enrolledCourseIds.length > 0) {
    scopeFilters.push({ courseId: { in: context.enrolledCourseIds } });
  }

  const exam = await db.examEntry.findFirst({
    where: {
      id,
      organizationId: context.organizationId,
      OR: scopeFilters.length > 0 ? scopeFilters : [{ id: "__no_match__" }],
    },
    include: {
      attachments: true,
      course: { select: { code: true, name: true } },
    },
  });

  if (!exam) {
    return NextResponse.json({ error: "Exam entry not found" }, { status: 404 });
  }

  const pdfAttachment = exam.attachments.find((attachment) =>
    attachment.mime.toLowerCase().includes("pdf")
  );
  if (!pdfAttachment) {
    return NextResponse.json(
      { error: "No PDF attachment found for this exam entry." },
      { status: 404 }
    );
  }

  try {
    const result = await searchTextPdfFromUrl(pdfAttachment.url, query);
    if (!result.searchable) {
      return NextResponse.json({
        searchAvailable: false,
        message: "Search unavailable (scanned/image-only PDF).",
      });
    }

    return NextResponse.json({
      searchAvailable: true,
      query,
      attachment: {
        id: pdfAttachment.id,
        fileName: pdfAttachment.fileName,
        url: pdfAttachment.url,
      },
      matches: result.matches,
    });
  } catch (error) {
    console.error("Exam PDF search error:", error);
    return NextResponse.json(
      { error: "Unable to search this PDF right now." },
      { status: 500 }
    );
  }
}

