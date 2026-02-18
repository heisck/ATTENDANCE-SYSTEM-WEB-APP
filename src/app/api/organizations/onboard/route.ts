import { NextRequest, NextResponse } from "next/server";
import { onboardOrganization } from "@/services/organization.service";
import { createOrganizationSchema } from "@/lib/validators";
import { z } from "zod";

const onboardSchema = createOrganizationSchema.extend({
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  campusLat: z.number().optional(),
  campusLng: z.number().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = onboardSchema.parse(body);

    const org = await onboardOrganization({
      orgName: parsed.name,
      orgSlug: parsed.slug,
      orgDomain: parsed.domain,
      adminName: parsed.adminName,
      adminEmail: parsed.adminEmail,
      adminPassword: parsed.adminPassword,
      campusLat: parsed.campusLat,
      campusLng: parsed.campusLng,
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
