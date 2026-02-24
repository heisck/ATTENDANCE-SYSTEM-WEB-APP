import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestQrPort } from "@/lib/qr-port";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user as { id: string; role: string };
  if (user.role !== "STUDENT") {
    return NextResponse.json({ error: "Only students can request QR port" }, { status: 403 });
  }

  const body = await request.json();
  const sessionId = body.sessionId;
  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const result = await requestQrPort(sessionId, user.id);
  if (!result.success) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json(result);
}
