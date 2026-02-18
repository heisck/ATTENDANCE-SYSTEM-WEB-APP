import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role) || !user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();

    const org = await db.organization.findUnique({
      where: { id: user.organizationId },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const currentSettings = (org.settings as any) || {};
    const newSettings = { ...currentSettings, ...body.settings };

    const updated = await db.organization.update({
      where: { id: user.organizationId },
      data: { settings: newSettings },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Update settings error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role) || !user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { action, cidr, label, rangeId } = await request.json();

    if (action === "addIpRange") {
      if (!cidr || !label) {
        return NextResponse.json({ error: "CIDR and label required" }, { status: 400 });
      }

      const range = await db.trustedIpRange.create({
        data: {
          organizationId: user.organizationId,
          cidr,
          label,
        },
      });
      return NextResponse.json(range, { status: 201 });
    }

    if (action === "removeIpRange") {
      if (!rangeId) {
        return NextResponse.json({ error: "Range ID required" }, { status: 400 });
      }

      await db.trustedIpRange.delete({ where: { id: rangeId } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Settings action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
