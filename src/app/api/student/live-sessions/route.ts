import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { TOTAL_SESSION_MS, deriveAttendancePhase } from "@/lib/attendance";
import { cacheGet, cacheSet } from "@/lib/cache";

const ACTIVE_POLL_MS = 15_000;
const IDLE_POLL_MS = 45_000;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cacheKey = `student:live-sessions:${user.id}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  }

  const now = new Date();
  const activeWindowStart = new Date(now.getTime() - TOTAL_SESSION_MS);

  const sessions = await db.attendanceSession.findMany({
    where: {
      status: "ACTIVE",
      startedAt: { gt: activeWindowStart },
      course: {
        enrollments: {
          some: { studentId: user.id },
        },
      },
    },
    select: {
      id: true,
      status: true,
      phase: true,
      startedAt: true,
      initialEndsAt: true,
      reverifyEndsAt: true,
      course: { select: { code: true, name: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  const normalized = sessions
    .map((sessionRow) => {
      const phase = deriveAttendancePhase(
        {
          status: sessionRow.status,
          phase: sessionRow.phase,
          startedAt: sessionRow.startedAt,
          initialEndsAt: sessionRow.initialEndsAt,
          reverifyEndsAt: sessionRow.reverifyEndsAt,
        },
        now
      );

      return {
        id: sessionRow.id,
        phase,
        startedAt: sessionRow.startedAt.toISOString(),
        course: sessionRow.course,
      };
    })
    .filter((sessionRow) => sessionRow.phase !== "CLOSED");

  const payload = {
    sessions: normalized,
    polledAt: now.toISOString(),
    nextPollMs: normalized.length > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  };
  await cacheSet(cacheKey, payload, 2);

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
