import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [credentials, userState] = await Promise.all([
      db.webAuthnCredential.findMany({
        where: { userId: session.user.id },
        select: {
          credentialId: true,
          deviceType: true,
          userAgent: true,
          transports: true,
          backedUp: true,
          registeredAt: true,
        },
        orderBy: { registeredAt: "desc" },
      }),
      db.user.findUnique({
        where: { id: session.user.id },
        select: { passkeysLockedUntilAdminReset: true },
      }),
    ]);

    if (!userState) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      devices: credentials.map((cred) => ({
        id: cred.credentialId,
        credentialId: cred.credentialId,
        deviceType: cred.deviceType,
        userAgent: cred.userAgent || "Unknown Device",
        transports: cred.transports,
        backedUp: cred.backedUp,
        registeredAt: cred.registeredAt,
      })),
      passkeysLockedUntilAdminReset: userState.passkeysLockedUntilAdminReset,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
