import { db } from "@/lib/db";

export type CourseRepScopeSummary = {
  id: string;
  active: boolean;
  cohortId: string | null;
  courseId: string | null;
};

export async function getCourseRepScopes(
  userId: string,
  organizationId: string
): Promise<CourseRepScopeSummary[]> {
  const scopes = await db.courseRepScope.findMany({
    where: {
      userId,
      organizationId,
      active: true,
    },
    select: {
      id: true,
      active: true,
      cohortId: true,
      courseId: true,
    },
  });

  return scopes.map((scope) => ({
    id: scope.id,
    active: scope.active,
    cohortId: scope.cohortId,
    courseId: scope.courseId,
  }));
}

export function hasMatchingScope(
  scopes: CourseRepScopeSummary[],
  params: { cohortId?: string | null; courseId?: string | null }
): boolean {
  const cohortId = params.cohortId || null;
  const courseId = params.courseId || null;

  return scopes.some((scope) => {
    const cohortMatch = scope.cohortId ? scope.cohortId === cohortId : true;
    const courseMatch = scope.courseId ? scope.courseId === courseId : true;
    return cohortMatch && courseMatch;
  });
}

export async function ensureCourseRepScope(params: {
  userId: string;
  organizationId: string;
  cohortId?: string | null;
  courseId?: string | null;
}): Promise<boolean> {
  const scopes = await getCourseRepScopes(params.userId, params.organizationId);
  return hasMatchingScope(scopes, {
    cohortId: params.cohortId,
    courseId: params.courseId,
  });
}