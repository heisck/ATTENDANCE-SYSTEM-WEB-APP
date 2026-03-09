import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json(
    {
      error:
        "Legacy reverification retry is disabled. Start a dedicated Phase 2 session instead.",
      sessionId: id,
    },
    { status: 410 }
  );
}
