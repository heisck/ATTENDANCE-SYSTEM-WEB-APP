import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardOrganization } from "@/services/organization.service";
import { createOrganizationSchema } from "@/lib/validators";
import { z } from "zod";

const onboardSchema = createOrganizationSchema.extend({
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

function hasValidBootstrapSecret(request: NextRequest) {
  const configuredSecret = process.env.ORGANIZATION_ONBOARDING_SECRET?.trim() || "";
  const providedSecret = request.headers.get("x-onboarding-secret")?.trim() || "";

  if (!configuredSecret || !providedSecret) {
    return false;
  }

  const configuredBuffer = Buffer.from(configuredSecret);
  const providedBuffer = Buffer.from(providedSecret);
  if (configuredBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(configuredBuffer, providedBuffer);
}

export async function POST(request: NextRequest) {
  try {
    const [session, organizationCount, userCount] = await Promise.all([
      auth(),
      db.organization.count(),
      db.user.count(),
    ]);

    const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
    const isInitialBootstrap = organizationCount === 0 && userCount === 0;

    if (!isSuperAdmin) {
      if (!isInitialBootstrap) {
        return NextResponse.json(
          { error: "Only super admins can onboard organizations." },
          { status: 403 }
        );
      }

      if (!hasValidBootstrapSecret(request)) {
        return NextResponse.json(
          {
            error:
              "Initial bootstrap requires a valid organization onboarding secret.",
          },
          { status: 401 }
        );
      }
    }

    const body = await request.json();
    const parsed = onboardSchema.parse(body);

    const org = await onboardOrganization({
      orgName: parsed.name,
      orgSlug: parsed.slug,
      orgDomain: parsed.domain,
      adminName: parsed.adminName,
      adminEmail: parsed.adminEmail,
      adminPassword: parsed.adminPassword,
    });

    return NextResponse.json(
      {
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
        },
        admin: org.users[0],
        subscription: org.subscription,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    if (error.message?.includes("already")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Onboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
