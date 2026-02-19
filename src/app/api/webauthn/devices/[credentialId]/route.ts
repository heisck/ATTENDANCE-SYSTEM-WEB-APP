import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ credentialId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { credentialId } = await params;

    const credential = await db.webAuthnCredential.findUnique({
      where: { credentialId },
    });

    if (!credential || credential.userId !== session.user.id) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    // Check if user would be left without any credentials
    const credentialCount = await db.webAuthnCredential.count({
      where: { userId: session.user.id },
    });

    if (credentialCount <= 1) {
      return NextResponse.json(
        { error: "You must have at least one device registered" },
        { status: 400 }
      );
    }

    // Delete the credential
    await db.webAuthnCredential.delete({
      where: { credentialId },
    });

    return NextResponse.json({
      success: true,
      message: "Device removed successfully",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
