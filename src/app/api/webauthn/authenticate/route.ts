import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAuthenticationOptions,
  verifyAuthentication,
} from "@/lib/webauthn";
import { logError, ApiErrorMessages } from "@/lib/api-error";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: ApiErrorMessages.UNAUTHORIZED }, { status: 401 });
  }

  try {
    const options = await getAuthenticationOptions(session.user.id);
    return NextResponse.json(options);
  } catch (error: unknown) {
    logError("webauthn/authenticate GET", error, { userId: session.user.id });
    return NextResponse.json(
      { error: ApiErrorMessages.WEBAUTHN_ERROR },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: ApiErrorMessages.UNAUTHORIZED }, { status: 401 });
  }

  try {
    const body = await request.json();
    const verification = await verifyAuthentication(session.user.id, body);

    return NextResponse.json({
      verified: verification.verified,
    });
  } catch (error: unknown) {
    logError("webauthn/authenticate POST", error, { userId: session.user.id });
    return NextResponse.json(
      { error: ApiErrorMessages.WEBAUTHN_CHALLENGE_FAILED },
      { status: 400 }
    );
  }
}
