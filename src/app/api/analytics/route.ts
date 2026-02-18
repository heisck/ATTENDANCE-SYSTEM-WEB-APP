import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrganizationAnalytics } from "@/services/attendance.service";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!user.organizationId && user.role === "ADMIN") {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const orgId = user.organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "Organization required" }, { status: 400 });
  }

  const analytics = await getOrganizationAnalytics(orgId);
  return NextResponse.json(analytics);
}
