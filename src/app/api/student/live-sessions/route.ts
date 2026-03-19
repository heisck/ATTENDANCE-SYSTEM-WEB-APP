import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deriveAttendancePhase } from "@/lib/attendance";
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
  const sessions = await db.attendanceSession.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { gt: now },
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
      endsAt: true,
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
          endsAt: sessionRow.endsAt,
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
