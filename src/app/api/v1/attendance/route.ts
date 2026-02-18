import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

async function validateApiKey(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) return null;

  const org = await db.organization.findFirst({
    where: {
      settings: {
        path: ["apiKey"],
        equals: apiKey,
      },
    },
  });

  return org;
}

export async function GET(request: NextRequest) {
  const org = await validateApiKey(request);
  if (!org) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: any = {
    session: {
      course: { organizationId: org.id },
    },
  };

  if (courseId) {
    where.session.courseId = courseId;
  }

  if (from || to) {
    where.markedAt = {};
    if (from) where.markedAt.gte = new Date(from);
    if (to) where.markedAt.lte = new Date(to);
  }

  const records = await db.attendanceRecord.findMany({
    where,
    include: {
      student: { select: { name: true, studentId: true, email: true } },
      session: {
        include: { course: { select: { code: true, name: true } } },
      },
    },
    orderBy: { markedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    organization: org.slug,
    count: records.length,
    records: records.map((r) => ({
      id: r.id,
      student: r.student,
      course: r.session.course,
      sessionDate: r.session.startedAt,
      markedAt: r.markedAt,
      confidence: r.confidence,
      flagged: r.flagged,
      gpsDistance: r.gpsDistance,
      ipTrusted: r.ipTrusted,
      webauthnUsed: r.webauthnUsed,
    })),
  });
}
