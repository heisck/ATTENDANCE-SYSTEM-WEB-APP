import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cacheSet } from "@/lib/cache";
import { db } from "@/lib/db";
import { listQrPortRequests } from "@/lib/qr-port";

type StaffUser = {
  id: string;
  role: string;
  organizationId?: string | null;
};

async function canManageQrPortSession(user: StaffUser, sessionId: string) {
  const sessionRow = await db.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      lecturerId: true,
      course: {
        select: {
          organizationId: true,
        },
      },
    },
  });

  if (!sessionRow) {
    return { ok: false as const, status: 404, error: "Session not found" };
  }

  if (user.role === "LECTURER") {
    return sessionRow.lecturerId === user.id
      ? { ok: true as const, sessionRow }
      : { ok: false as const, status: 403, error: "Forbidden" };
  }

  if (user.role === "ADMIN") {
    return user.organizationId === sessionRow.course.organizationId
      ? { ok: true as const, sessionRow }
      : { ok: false as const, status: 403, error: "Forbidden" };
  }

  if (user.role === "SUPER_ADMIN") {
    return { ok: true as const, sessionRow };
  }

  return { ok: false as const, status: 403, error: "Forbidden" };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as StaffUser;
  if (!["LECTURER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const access = await canManageQrPortSession(user, sessionId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const requests = await listQrPortRequests(sessionId);
  return NextResponse.json({ requests });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as StaffUser;
  if (!["LECTURER", "ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const qrPortRequestId = body?.qrPortRequestId;

  if (typeof action !== "string" || typeof qrPortRequestId !== "string") {
    return NextResponse.json(
      { error: "action and qrPortRequestId required" },
      { status: 400 }
    );
  }

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const requestRow = await db.qrPortRequest.findUnique({
    where: { id: qrPortRequestId },
    select: {
      id: true,
      sessionId: true,
      studentId: true,
    },
  });

  if (!requestRow) {
    return NextResponse.json({ error: "QR port request not found" }, { status: 404 });
  }

  const access = await canManageQrPortSession(user, requestRow.sessionId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const nextStatus = action === "approve" ? "APPROVED" : "REJECTED";

  await db.qrPortRequest.update({
    where: { id: requestRow.id },
    data: {
      status: nextStatus,
      reviewedAt: new Date(),
      reviewedBy: user.id,
    },
  });

  await cacheSet(
    `attendance:qr-port-status:${requestRow.sessionId}:${requestRow.studentId}`,
    nextStatus,
    3
  );

  return NextResponse.json({
    success: true,
    message: action === "approve" ? "QR port approved" : "QR port rejected",
  });
}
