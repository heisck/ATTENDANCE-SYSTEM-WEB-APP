import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { lecturerInviteSchema } from "@/lib/validators";
import { buildAppUrl, sendEmail } from "@/lib/email";
import { createRawToken, hashToken } from "@/lib/tokens";

function resolveOrganizationIdForStaff(
  user: { role?: string; organizationId?: string | null },
  requestedOrgId?: string | null
): string | null {
  if (user.role === "ADMIN") return user.organizationId || null;
  if (user.role === "SUPER_ADMIN") return requestedOrgId || user.organizationId || null;
  return null;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedOrgId = new URL(request.url).searchParams.get("organizationId");
  const organizationId = resolveOrganizationIdForStaff(user, requestedOrgId);
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  const invites = await db.lecturerInvite.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ invites });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = lecturerInviteSchema.parse(body);
    const invitedEmail = parsed.invitedEmail.trim().toLowerCase();
    const organizationId = resolveOrganizationIdForStaff(user, body.organizationId);
    if (!organizationId) {
      return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    }

    const [organization, existingUser] = await Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, slug: true },
      }),
      db.user.findUnique({
        where: { email: invitedEmail },
        select: { id: true, role: true },
      }),
    ]);

    if (!organization) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    if (existingUser) {
      return NextResponse.json({ error: "This email already has an account." }, { status: 409 });
    }

    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + parsed.ttlHours * 60 * 60 * 1000);

    const invite = await db.lecturerInvite.create({
      data: {
        organizationId: organization.id,
        invitedEmail,
        tokenHash,
        invitedByUserId: user.id,
        expiresAt,
      },
    });

    const acceptUrl = buildAppUrl(`/accept-invite?token=${encodeURIComponent(rawToken)}`);
    await sendEmail({
      to: invitedEmail,
      subject: `Lecturer invite for ${organization.name}`,
      html: `
        <p>You have been invited as a lecturer on AttendanceIQ (${organization.name}).</p>
        <p>Use this link to activate your lecturer account:</p>
        <p><a href="${acceptUrl}">Accept lecturer invite</a></p>
        <p>This invite expires on ${expiresAt.toUTCString()}.</p>
      `,
      text: `Accept your lecturer invite: ${acceptUrl}`,
    });

    return NextResponse.json({ invite, inviteUrl: acceptUrl }, { status: 201 });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Lecturer invite create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
