import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAcademicCalendarSettings,
  getEffectiveFeatureFlags,
  getStudentHubAccessState,
} from "@/lib/organization-settings";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "STUDENT") {
    return NextResponse.json({
      role: user.role,
      requiresProfileCompletion: false,
      personalEmailVerified: true,
      hasPasskey: true,
      canProceed: true,
    });
  }

  const [student, credentialCount] = await Promise.all([
    db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        organizationId: true,
        personalEmail: true,
        personalEmailVerifiedAt: true,
        organization: {
          select: {
            settings: true,
          },
        },
        cohort: {
          select: {
            id: true,
            department: true,
            level: true,
            groupCode: true,
            displayName: true,
          },
        },
      },
    }),
    db.webAuthnCredential.count({
      where: { userId: user.id },
    }),
  ]);

  if (!student) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const requiresProfileCompletion = !student.personalEmail;
  const personalEmailVerified = Boolean(student.personalEmailVerifiedAt);
  const hasPasskey = credentialCount > 0;
  const canProceed = !requiresProfileCompletion && personalEmailVerified && hasPasskey;
  const settings = student.organization?.settings;
  const cohortId = student.cohort?.id || null;
  const rawFeatureFlags = getEffectiveFeatureFlags(settings, cohortId);
  const studentHubAccess = getStudentHubAccessState(settings, new Date(), cohortId);
  const featureFlags = studentHubAccess.accessAllowed
    ? rawFeatureFlags
    : {
        ...rawFeatureFlags,
        studentHubCore: false,
        courseRepTools: false,
        examHub: false,
        groupFormation: false,
      };
  const academicCalendar = getAcademicCalendarSettings(settings);
  const scopes =
    student.organizationId
      ? await db.courseRepScope.findMany({
          where: {
            userId: student.id,
            organizationId: student.organizationId,
            active: true,
          },
          select: {
            id: true,
            cohortId: true,
            courseId: true,
          },
        })
      : [];

  return NextResponse.json({
    role: user.role,
    requiresProfileCompletion,
    personalEmailVerified,
    hasPasskey,
    canProceed,
    featureFlags,
    studentHubAccess,
    academicCalendar,
    cohort: student.cohort,
    isCourseRep: scopes.length > 0,
    courseRepScopes: scopes,
  });
}
