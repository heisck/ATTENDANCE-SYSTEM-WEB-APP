import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAuthenticationOptions,
  verifyAuthentication,
} from "@/lib/webauthn";
import { logError, ApiErrorMessages } from "@/lib/api-error";
import {
  clearAttendanceProofCookie,
  setAttendanceProofCookie,
} from "@/lib/attendance-proof";
import {
  clearBrowserDeviceProofCookie,
  extractBrowserDeviceBinding,
  setBrowserDeviceProofCookie,
} from "@/lib/browser-device-proof";

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
    const verificationBody =
      body && typeof body === "object" && "authentication" in body
        ? (body.authentication as Record<string, unknown>)
        : body;
    const deviceBinding =
      body && typeof body === "object"
        ? extractBrowserDeviceBinding(request, body as Record<string, unknown>)
        : null;
    const verification = await verifyAuthentication(session.user.id, verificationBody);
    const response = NextResponse.json({
      verified: verification.verified,
    });
    if (verification.verified) {
      setAttendanceProofCookie(response, session.user.id);
      if (deviceBinding) {
        setBrowserDeviceProofCookie(response, {
          userId: session.user.id,
          deviceToken: deviceBinding.deviceToken,
          fingerprintHash: deviceBinding.fingerprintHash,
        });
      } else {
        clearBrowserDeviceProofCookie(response);
      }
    } else {
      clearAttendanceProofCookie(response);
      clearBrowserDeviceProofCookie(response);
    }
    return response;
  } catch (error: unknown) {
    logError("webauthn/authenticate POST", error, { userId: session.user.id });
    const response = NextResponse.json(
      { error: ApiErrorMessages.WEBAUTHN_CHALLENGE_FAILED },
      { status: 400 }
    );
    clearAttendanceProofCookie(response);
    clearBrowserDeviceProofCookie(response);
    return response;
  }
}
