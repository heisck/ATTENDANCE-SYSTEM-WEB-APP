import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runReminderEngine } from "@/services/notification.service";

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.REMINDER_CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("x-cron-secret");
  return provided === secret;
}

export async function POST(request: NextRequest) {
  const cronAuthorized = isCronAuthorized(request);
  if (!cronAuthorized) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = (session.user as any).role as string;
    if (!["ADMIN", "SUPER_ADMIN"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await runReminderEngine();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Reminder engine failed:", error);
    return NextResponse.json({ error: "Reminder engine failed" }, { status: 500 });
  }
}
