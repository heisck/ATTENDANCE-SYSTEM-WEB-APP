import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getRegistrationOptions,
  verifyRegistration,
} from "@/lib/webauthn";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const options = await getRegistrationOptions(
      session.user.id,
      session.user.email!
    );
    return NextResponse.json(options);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const userAgent = request.headers.get("user-agent") || undefined;
    const verification = await verifyRegistration(
      session.user.id,
      body,
      userAgent
    );

    return NextResponse.json({
      verified: verification.verified,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
