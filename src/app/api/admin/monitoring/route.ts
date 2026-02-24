import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cacheGetOrCompute, CACHE_KEYS, CACHE_TTL } from "@/lib/cache";

/**
 * GET /api/admin/monitoring
 * Real-time session monitoring for admin dashboard
 * Tracks attendance progress, anomalies, and system health
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admins can view monitoring
  if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const sessionId = new URL(request.url).searchParams.get("sessionId");

    if (!sessionId) {
      // Get all active sessions for organization
      return getAllActiveSessionsMonitoring(session.user.organizationId);
    }

    // Get specific session monitoring data
    return getSessionMonitoringDetail(sessionId, session.user.organizationId);
  } catch (error) {
    console.error("[v0] Monitoring API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function getAllActiveSessionsMonitoring(organizationId: string | null) {
  if (!organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const now = new Date();

  try {
    const sessions = await db.attendanceSession.findMany({
      where: {
        course: { organizationId },
        status: "ACTIVE",
      },
      include: {
        course: {
          select: { code: true, name: true },
        },
        _count: {
          select: {
            records: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
      take: 20,
    });

    const monitoring = await Promise.all(
      sessions.map(async (session) => {
        const enrolled = await db.enrollment.count({
          where: { courseId: session.courseId },
        });

        const flagged = await db.attendanceRecord.count({
          where: {
            sessionId: session.id,
            flagged: true,
          },
        });

        const anomalies = await db.attendanceAnomaly.count({
          where: {
            sessionId: session.id,
            reviewedAt: null,
          },
        });

        const avgConfidence = await db.attendanceRecord.aggregate({
          where: { sessionId: session.id },
          _avg: { confidence: true },
        });

        return {
          sessionId: session.id,
          courseCode: session.course.code,
          courseName: session.course.name,
          status: session.status,
          phase: session.phase,
          startedAt: session.startedAt,
          totalEnrolled: enrolled,
          totalAttempted: session._count.records,
          flaggedCount: flagged,
          anomalyCount: anomalies,
          progressPercent: enrolled > 0 ? Math.round((session._count.records / enrolled) * 100) : 0,
          averageConfidence: Math.round(avgConfidence._avg.confidence || 0),
          estimatedCompletion: estimateCompletion(session.initialEndsAt, session.startedAt),
        };
      })
    );

    return NextResponse.json({
      activeSessions: monitoring,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("[v0] Get all sessions error:", error);
    throw error;
  }
}

async function getSessionMonitoringDetail(
  sessionId: string,
  organizationId: string | null
) {
  if (!organizationId) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  try {
    // Get session with verification that it belongs to this org
    const session = await db.attendanceSession.findFirst({
      where: {
        id: sessionId,
        course: { organizationId },
      },
      include: {
        course: { select: { code: true, name: true } },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Use cache for expensive aggregations
    const cacheKey = `monitoring:${sessionId}`;
    const cached = await cacheGetOrCompute(
      cacheKey,
      CACHE_TTL.ANALYTICS,
      async () => {
        const enrolled = await db.enrollment.count({
          where: { courseId: session.courseId },
        });

        const records = await db.attendanceRecord.findMany({
          where: { sessionId },
          select: {
            id: true,
            studentId: true,
            confidence: true,
            flagged: true,
            anomalyScore: true,
            markedAt: true,
            reverifyStatus: true,
          },
        });

        const anomalies = await db.attendanceAnomaly.findMany({
          where: { sessionId },
          select: {
            id: true,
            anomalyType: true,
            severity: true,
            studentId: true,
            reviewedAt: true,
          },
        });

        const flaggedByType = anomalies.reduce(
          (acc, a) => {
            acc[a.anomalyType] = (acc[a.anomalyType] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        const confScores = records.map((r) => r.confidence);
        const avgConfidence =
          confScores.length > 0
            ? Math.round(confScores.reduce((a, b) => a + b) / confScores.length)
            : 0;

        const p95Confidence = confScores
          .sort((a, b) => a - b)
          [Math.floor(confScores.length * 0.05)];

        return {
          enrolled,
          attempted: records.length,
          flaggedCount: records.filter((r) => r.flagged).length,
          unreviewedAnomalies: anomalies.filter((a) => !a.reviewedAt).length,
          averageConfidence: avgConfidence,
          p95Confidence: Math.round(p95Confidence || 0),
          anomaliesByType: flaggedByType,
          reverifyPending: records.filter((r) => r.reverifyStatus === "PENDING").length,
          reverifyFailed: records.filter((r) => r.reverifyStatus === "FAILED").length,
          lastUpdated: new Date().toISOString(),
        };
      }
    );

    return NextResponse.json({
      session: {
        id: session.id,
        courseCode: session.course.code,
        courseName: session.course.name,
        phase: session.phase,
        startedAt: session.startedAt,
        initialEndsAt: session.initialEndsAt,
        reverifyEndsAt: session.reverifyEndsAt,
        closedAt: session.closedAt,
      },
      monitoring: cached,
    });
  } catch (error) {
    console.error("[v0] Get session detail error:", error);
    throw error;
  }
}

function estimateCompletion(initialEndsAt: Date | null, startedAt: Date): Date {
  // Estimate based on initial phase duration
  const totalDuration = initialEndsAt ? initialEndsAt.getTime() - startedAt.getTime() : 5 * 60 * 1000;
  const reverifyDuration = 4 * 60 * 1000; // 4 minutes default reverify
  return new Date(startedAt.getTime() + totalDuration + reverifyDuration);
}
