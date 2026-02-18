import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAuthenticationOptions,
  verifyAuthentication,
} from "@/lib/webauthn";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const options = await getAuthenticationOptions(session.user.id);
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
    const verification = await verifyAuthentication(session.user.id, body);

    return NextResponse.json({
      verified: verification.verified,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
