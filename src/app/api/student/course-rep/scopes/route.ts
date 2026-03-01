import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEffectiveFeatureFlags } from "@/lib/organization-settings";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      organizationId: true,
      cohortId: true,
      organization: {
        select: {
          settings: true,
        },
      },
      cohort: {
        select: {
          id: true,
          displayName: true,
          department: true,
          level: true,
          groupCode: true,
        },
      },
    },
  });

  if (!user?.organizationId) {
    return NextResponse.json({
      isCourseRep: false,
      courseRepToolsEnabled: false,
      scopes: [],
      cohort: user?.cohort ?? null,
    });
  }

  const flags = getEffectiveFeatureFlags(user.organization?.settings, user.cohortId);
  const courseRepToolsEnabled = flags.studentHubCore && flags.courseRepTools;

  const scopes = await db.courseRepScope.findMany({
    where: {
      userId: session.user.id,
      organizationId: user.organizationId,
      active: true,
    },
    include: {
      cohort: {
        select: {
          id: true,
          displayName: true,
          department: true,
          level: true,
          groupCode: true,
        },
      },
      course: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    isCourseRep: scopes.length > 0 && courseRepToolsEnabled,
    courseRepToolsEnabled,
    scopes,
    cohort: user.cohort,
  });
}
