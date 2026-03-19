import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cacheDel } from "@/lib/cache";

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

    if (
      !targetUser ||
      (user.role !== "SUPER_ADMIN" && targetUser.organizationId !== user.organizationId)
    ) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Count credentials before deletion
    const credentialCount = await db.webAuthnCredential.count({
      where: { userId },
    });

    // Delete all credentials for the user
    await db.webAuthnCredential.deleteMany({
      where: { userId },
    });

    // Reset the lock so user can create new passkeys
    await db.user.update({
      where: { id: userId },
      data: {
        passkeysLockedUntilAdminReset: false,
        firstPasskeyCreatedAt: null,
      },
    });

    // Log the action
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: "PASSKEYS_DELETED",
        metadata: {
          targetUserId: userId,
          targetUserEmail: targetUser.email,
          credentialsDeleted: credentialCount,
        },
      },
    });

    await cacheDel(`attendance:credential-count:${userId}`);

    return NextResponse.json({
      success: true,
      message: `${credentialCount} passkey(s) deleted successfully`,
      deletedCount: credentialCount,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
