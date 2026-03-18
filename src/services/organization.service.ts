import { db } from "@/lib/db";
import { SubscriptionPlan, Role } from "@prisma/client";
import { hashPassword } from "@/lib/passwords";

export async function onboardOrganization(input: {
  orgName: string;
  orgSlug: string;
  orgDomain?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
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

  const passwordHash = await hashPassword(input.adminPassword);

  const org = await db.organization.create({
    data: {
      name: input.orgName,
      slug: input.orgSlug,
      domain: input.orgDomain,
      settings: {
        confidenceThreshold: 70,
        studentEmailDomains: input.orgDomain ? [input.orgDomain, `st.${input.orgDomain}`] : [],
        timezone: "UTC",
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
