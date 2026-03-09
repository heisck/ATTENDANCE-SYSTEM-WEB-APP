import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Legacy reverification flow is disabled. Use lecturer Phase 2 session and mark attendance through the standard QR endpoint.",
    },
    { status: 410 }
  );
}
