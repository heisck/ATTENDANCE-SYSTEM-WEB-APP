import { db } from "@/lib/db";
import { hasMatchingScope } from "@/lib/course-rep";
import { getStudentRepContext } from "@/lib/course-rep-auth";
import { isAdminLike, resolveOrganizationIdForStaff } from "@/lib/permissions";
import { getEffectiveFeatureFlags } from "@/lib/organization-settings";

type SessionUserLike = {
  id: string;
  role?: string;
  organizationId?: string | null;
};

type FeatureFlagKey = "examHub" | "groupFormation";

export type ScopedActorContext = {
  userId: string;
  organizationId: string;
  isAdmin: boolean;
};

export async function resolveRepOrAdminWriteAccess(input: {
  sessionUser: SessionUserLike;
  requestedOrganizationId?: string | null;
  cohortId?: string | null;
  courseId?: string | null;
  requiredFlag: FeatureFlagKey;
}): Promise<
  | { ok: true; context: ScopedActorContext }
  | { ok: false; status: number; error: string }
> {
  if (isAdminLike(input.sessionUser.role)) {
    const organizationId = resolveOrganizationIdForStaff(
      {
        role: input.sessionUser.role,
        organizationId: input.sessionUser.organizationId ?? null,
      },
      input.requestedOrganizationId ?? null
    );
    if (!organizationId) {
      return { ok: false, status: 400, error: "organizationId is required" };
    }

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!organization) {
      return { ok: false, status: 404, error: "Organization not found" };
    }

    const flags = getEffectiveFeatureFlags(organization.settings, input.cohortId ?? null);
    if (!flags.studentHubCore || !flags[input.requiredFlag]) {
      return { ok: false, status: 403, error: `${input.requiredFlag} feature is disabled` };
    }

    return {
      ok: true,
      context: {
        userId: input.sessionUser.id,
        organizationId,
        isAdmin: true,
      },
    };
  }

  const repContext = await getStudentRepContext(input.sessionUser.id);
  if (!repContext || !repContext.isCourseRep || !repContext.user.organizationId) {
    return { ok: false, status: 403, error: "Course Rep access required" };
  }

  if (!repContext.featureFlags.studentHubCore || !repContext.featureFlags[input.requiredFlag]) {
    return { ok: false, status: 403, error: `${input.requiredFlag} feature is disabled` };
  }

  const withinScope = hasMatchingScope(repContext.scopes, {
    cohortId: input.cohortId ?? null,
    courseId: input.courseId ?? null,
  });
  if (!withinScope) {
    return { ok: false, status: 403, error: "Scope mismatch for requested resource" };
  }

  return {
    ok: true,
    context: {
      userId: repContext.user.id,
      organizationId: repContext.user.organizationId,
      isAdmin: false,
    },
  };
}
