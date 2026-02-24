import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listQrPortRequests, approveQrPort, rejectQrPort } from "@/lib/qr-port";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user as { id: string; role: string };
  if (user.role !== "LECTURER" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const requests = await listQrPortRequests(sessionId);
  return NextResponse.json({ requests });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user as { id: string; role: string };
  if (user.role !== "LECTURER" && user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { action, qrPortRequestId } = body;
  if (!qrPortRequestId || !action) {
    return NextResponse.json(
      { error: "action and qrPortRequestId required" },
      { status: 400 }
    );
  }

  if (action === "approve") {
    const result = await approveQrPort(qrPortRequestId, user.id);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    return NextResponse.json(result);
  }
  if (action === "reject") {
    const result = await rejectQrPort(qrPortRequestId, user.id);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}