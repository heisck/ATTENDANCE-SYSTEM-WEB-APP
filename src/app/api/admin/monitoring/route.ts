import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cacheGetOrCompute, CACHE_TTL } from "@/lib/cache";

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

    // Batch all counts in parallel instead of N+1 per-session queries
    const sessionIds = sessions.map((s) => s.id);
    const courseIds = [...new Set(sessions.map((s) => s.courseId))];

    const [enrollmentCounts, flaggedCounts, anomalyCounts, confidenceAverages] =
      await Promise.all([
        // One query for all enrollment counts
        db.enrollment.groupBy({
          by: ["courseId"],
          where: { courseId: { in: courseIds } },
          _count: { _all: true },
        }),
        // One query for all flagged counts
        db.attendanceRecord.groupBy({
          by: ["sessionId"],
          where: { sessionId: { in: sessionIds }, flagged: true },
          _count: { _all: true },
        }),
        // One query for all anomaly counts
        db.attendanceAnomaly.groupBy({
          by: ["sessionId"],
          where: {
            sessionId: { in: sessionIds },
            reviewedAt: null,
          },
          _count: { _all: true },
        }),
        // One query for all confidence averages
        db.attendanceRecord.groupBy({
          by: ["sessionId"],
          where: { sessionId: { in: sessionIds } },
          _avg: { confidence: true },
        }),
      ]);

    // Index results by session/course ID for O(1) lookup
    const enrollmentMap = new Map(
      enrollmentCounts.map((e) => [e.courseId, e._count._all])
    );
    const flaggedMap = new Map(
      flaggedCounts.map((f) => [f.sessionId, f._count._all])
    );
    const anomalyMap = new Map(
      anomalyCounts.map((a) => [a.sessionId, a._count._all])
    );
    const confidenceMap = new Map(
      confidenceAverages.map((c) => [c.sessionId, c._avg.confidence])
    );

    const monitoring = sessions.map((session) => {
      const enrolled = enrollmentMap.get(session.courseId) ?? 0;
      const flagged = flaggedMap.get(session.id) ?? 0;
      const anomalies = anomalyMap.get(session.id) ?? 0;
      const avgConf = confidenceMap.get(session.id) ?? 0;

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
        progressPercent:
          enrolled > 0
            ? Math.round((session._count.records / enrolled) * 100)
            : 0,
        averageConfidence: Math.round(avgConf || 0),
        estimatedCompletion: estimateCompletion(session.endsAt, session.startedAt),
      };
    });

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

        // Use DB aggregations instead of loading all records into memory
        const [recordAgg, flaggedCount, anomalyCounts, unreviewedCount] =
          await Promise.all([
            db.attendanceRecord.aggregate({
              where: { sessionId },
              _count: { id: true },
              _avg: { confidence: true },
            }),
            db.attendanceRecord.count({
              where: { sessionId, flagged: true },
            }),
            db.attendanceAnomaly.groupBy({
              by: ["anomalyType"],
              where: { sessionId },
              _count: { id: true },
            }),
            db.attendanceAnomaly.count({
              where: { sessionId, reviewedAt: null },
            }),
          ]);

        const flaggedByType = anomalyCounts.reduce(
          (acc, a) => {
            acc[a.anomalyType] = a._count.id;
            return acc;
          },
          {} as Record<string, number>
        );

        // Compute p95 confidence in PostgreSQL rather than in-memory sort
        let p95Confidence = 0;
        if (recordAgg._count.id > 0) {
          const p95Result = await db.$queryRaw<
            { p95: number }[]
          >`SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY confidence) AS p95
            FROM "AttendanceRecord" WHERE "sessionId" = ${sessionId}`;
          p95Confidence = Math.round(p95Result[0]?.p95 || 0);
        }

        return {
          enrolled,
          attempted: recordAgg._count.id,
          flaggedCount,
          unreviewedAnomalies: unreviewedCount,
          averageConfidence: Math.round(recordAgg._avg.confidence || 0),
          p95Confidence,
          anomaliesByType: flaggedByType,
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
        endsAt: session.endsAt,
        closedAt: session.closedAt,
      },
      monitoring: cached,
    });
  } catch (error) {
    console.error("[v0] Get session detail error:", error);
    throw error;
  }
}

function estimateCompletion(endsAt: Date | null, startedAt: Date): Date {
  if (endsAt) return endsAt;
  return new Date(startedAt.getTime() + 4 * 60 * 1000);
}
