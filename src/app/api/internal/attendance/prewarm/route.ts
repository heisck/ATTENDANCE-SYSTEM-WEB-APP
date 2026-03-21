import { NextRequest, NextResponse } from "next/server";
import {
  ATTENDANCE_PREWARM_HEADER,
  getAttendancePrewarmSecret,
  prewarmAttendanceSessionLocally,
} from "@/lib/attendance-prewarm";

export async function POST(request: NextRequest) {
  const secret = getAttendancePrewarmSecret();
  const providedSecret = request.headers.get(ATTENDANCE_PREWARM_HEADER);

  if (!secret || providedSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { sessionId?: unknown };
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : "";

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const warmed = await prewarmAttendanceSessionLocally(sessionId);
    if (!warmed) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      sessionId: warmed.sessionId,
      courseId: warmed.courseId,
      phase: warmed.phase,
      sessionFamilyId: warmed.sessionFamilyId,
    });
  } catch (error) {
    console.error("[attendance-prewarm] request failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
