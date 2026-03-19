import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { userId } = await params;

    // Verify the target user belongs to the same organization
    const targetUser = await db.user.findUnique({
      where: { id: userId },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const hasAccess =
      user.role === "SUPER_ADMIN" || targetUser.organizationId === user.organizationId;

    if (!hasAccess) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Unlock passkeys by resetting the lock flag
    await db.user.update({
      where: { id: userId },
      data: { passkeysLockedUntilAdminReset: false },
    });

    // Log the action
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: "PASSKEY_UNLOCKED",
        metadata: {
          targetUserId: userId,
          targetUserEmail: targetUser.email,
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Passkeys unlocked successfully",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
