import { db } from "@/lib/db";
import { hash } from "bcryptjs";
import { SubscriptionPlan, Role } from "@prisma/client";

export async function onboardOrganization(input: {
  orgName: string;
  orgSlug: string;
  orgDomain?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  campusLat?: number;
  campusLng?: number;
}) {
  const existingOrg = await db.organization.findUnique({
    where: { slug: input.orgSlug },
  });
  if (existingOrg) {
    throw new Error("Organization slug already exists");
  }

  const existingUser = await db.user.findUnique({
    where: { email: input.adminEmail },
  });
  if (existingUser) {
    throw new Error("Admin email already in use");
  }

  const passwordHash = await hash(input.adminPassword, 10);

  const org = await db.organization.create({
    data: {
      name: input.orgName,
      slug: input.orgSlug,
      domain: input.orgDomain,
      settings: {
        campusLat: input.campusLat || 0,
        campusLng: input.campusLng || 0,
        defaultRadiusMeters: 500,
        confidenceThreshold: 70,
      },
      subscription: {
        create: {
          plan: SubscriptionPlan.FREE,
          maxStudents: 100,
          maxCourses: 10,
        },
      },
      users: {
        create: {
          name: input.adminName,
          email: input.adminEmail,
          passwordHash,
          role: Role.ADMIN,
        },
      },
    },
    include: {
      users: { select: { id: true, email: true, role: true } },
      subscription: true,
    },
  });

  return org;
}
