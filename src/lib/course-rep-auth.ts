import { db } from "@/lib/db";
import { getCourseRepScopes, hasMatchingScope } from "@/lib/course-rep";
import { getFeatureFlags, getStudentHubAccessState } from "@/lib/organization-settings";

export async function getStudentRepContext(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      organizationId: true,
      cohortId: true,
      organization: {
        select: {
          settings: true,
        },
      },
    },
  });

  if (!user || user.role !== "STUDENT" || !user.organizationId) {
    return null;
  }

  const scopes = await getCourseRepScopes(user.id, user.organizationId);
  const rawFeatureFlags = getFeatureFlags(user.organization?.settings);
  const hubAccess = getStudentHubAccessState(user.organization?.settings);
  const featureFlags = hubAccess.accessAllowed
    ? rawFeatureFlags
    : {
        ...rawFeatureFlags,
        studentHubCore: false,
        courseRepTools: false,
        examHub: false,
        groupFormation: false,
      };
  const courseRepToolsEnabled = featureFlags.studentHubCore && featureFlags.courseRepTools;

  return {
    user,
    scopes,
    featureFlags,
    hubAccess,
    courseRepToolsEnabled,
    isCourseRep: scopes.length > 0 && courseRepToolsEnabled,
  };
}

export async function ensureRepAccess(params: {
  userId: string;
  cohortId?: string | null;
  courseId?: string | null;
}): Promise<{ allowed: boolean; organizationId?: string; scopeCount?: number }> {
  const context = await getStudentRepContext(params.userId);
  if (!context) return { allowed: false };
  if (!context.courseRepToolsEnabled) {
    return {
      allowed: false,
      organizationId: context.user.organizationId || undefined,
      scopeCount: context.scopes.length,
    };
  }

  const allowed = hasMatchingScope(context.scopes, {
    cohortId: params.cohortId ?? null,
    courseId: params.courseId ?? null,
  });

  return {
    allowed,
    organizationId: context.user.organizationId || undefined,
    scopeCount: context.scopes.length,
  };
}
