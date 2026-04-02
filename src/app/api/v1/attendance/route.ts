import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRateLimitKey } from "@/lib/cache";

async function validateApiKey(request: NextRequest) {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) return null;

  const org = await db.organization.findUnique({
    where: { apiKey },
  });

  return org;
}

function parseISODate(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export async function GET(request: NextRequest) {
  const org = await validateApiKey(request);
  if (!org) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  // Rate limit: 1000 requests per hour per organization
  try {
    const { allowed } = await checkRateLimitKey(
      `api-v1:${org.id}`,
      1000,
      3600
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Max 1000 requests per hour." },
        { status: 429 }
      );
    }
  } catch {
    // If Redis unavailable, allow through but log
    console.warn("[api/v1] Rate limit check failed for org:", org.id);
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
    if (from) {
      const parsedFrom = parseISODate(from);
      if (!parsedFrom) {
        return NextResponse.json({ error: "Invalid 'from' date format" }, { status: 400 });
      }
      where.markedAt.gte = parsedFrom;
    }
    if (to) {
      const parsedTo = parseISODate(to);
      if (!parsedTo) {
        return NextResponse.json({ error: "Invalid 'to' date format" }, { status: 400 });
      }
      where.markedAt.lte = parsedTo;
    }
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
      webauthnUsed: r.webauthnUsed,
    })),
  });
}
