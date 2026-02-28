import { db } from "@/lib/db";
import {
  getAcademicCalendarSettings,
  getFeatureFlags,
  getStudentHubAccessState,
  type AcademicCalendarSettings,
  type StudentHubAccessState,
} from "@/lib/organization-settings";

export type StudentHubContext = {
  userId: string;
  organizationId: string | null;
  cohortId: string | null;
  enrolledCourseIds: string[];
  featureFlags: {
    studentHubCore: boolean;
    courseRepTools: boolean;
    examHub: boolean;
    groupFormation: boolean;
  };
  hubAccess: StudentHubAccessState;
  academicCalendar: AcademicCalendarSettings;
};

export async function getStudentHubContext(userId: string): Promise<StudentHubContext | null> {
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
      enrollments: {
        select: {
          courseId: true,
        },
      },
    },
  });

  if (!user || user.role !== "STUDENT") {
    return null;
  }

  const settings = user.organization?.settings;
  const rawFeatureFlags = getFeatureFlags(settings);
  const hubAccess = getStudentHubAccessState(settings);
  const featureFlags = hubAccess.accessAllowed
    ? rawFeatureFlags
    : {
        ...rawFeatureFlags,
        studentHubCore: false,
        courseRepTools: false,
        examHub: false,
        groupFormation: false,
      };

  return {
    userId: user.id,
    organizationId: user.organizationId,
    cohortId: user.cohortId,
    enrolledCourseIds: user.enrollments.map((enrollment) => enrollment.courseId),
    featureFlags,
    hubAccess,
    academicCalendar: getAcademicCalendarSettings(settings),
  };
}
