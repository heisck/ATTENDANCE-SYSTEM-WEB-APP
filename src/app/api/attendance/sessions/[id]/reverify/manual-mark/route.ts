import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json(
    {
      error:
        "Manual reverification overrides are disabled with the new two-phase attendance model.",
      sessionId: id,
    },
    { status: 410 }
  );
}
