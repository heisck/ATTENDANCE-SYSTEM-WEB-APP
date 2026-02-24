import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLiveQrForPort } from "@/lib/qr-port";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = session.user as { id: string; role: string };
  if (user.role !== "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const data = await getLiveQrForPort(id, user.id);
  if (!data) {
    return NextResponse.json(
      { error: "QR port not approved or session closed" },
      { status: 403 }
    );
  }
  return NextResponse.json(data);
}