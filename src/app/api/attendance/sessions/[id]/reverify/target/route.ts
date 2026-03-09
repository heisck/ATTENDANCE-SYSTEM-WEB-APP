import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json(
    {
      error:
        "Targeted reverification is disabled. Use a Phase 2 attendance session for closing attendance.",
      sessionId: id,
    },
    { status: 410 }
  );
}
