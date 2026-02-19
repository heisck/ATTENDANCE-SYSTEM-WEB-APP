import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const credentials = await db.webAuthnCredential.findMany({
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
    });

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
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
