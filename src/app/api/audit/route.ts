import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAuditLogs } from "@/services/audit.service";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedOrgId = searchParams.get("organizationId");
  const organizationId =
    user.role === "SUPER_ADMIN"
      ? requestedOrgId || user.organizationId
      : user.organizationId;

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required for super-admin audit queries" },
      { status: 400 }
    );
  }

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const action = searchParams.get("action") || undefined;

  const result = await getAuditLogs(organizationId, { page, action });
  return NextResponse.json(result);
}
