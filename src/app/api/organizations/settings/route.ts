import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAcademicCalendarSettings,
  getAcademicProgressionSettings,
  getOrganizationSettings,
} from "@/lib/organization-settings";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  const output: Record<string, any> = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = output[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      output[key] = deepMerge(baseValue, patchValue);
    } else {
      output[key] = patchValue;
    }
  }

  return output;
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role) || !user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    if (!isPlainObject(body) || !isPlainObject(body.settings)) {
      return NextResponse.json({ error: "settings object is required" }, { status: 400 });
    }

    const org = await db.organization.findUnique({
      where: { id: user.organizationId },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const currentSettings = getOrganizationSettings(org.settings);
    const newSettings = deepMerge(currentSettings, body.settings as Record<string, unknown>);

    const updated = await db.organization.update({
      where: { id: user.organizationId },
      data: { settings: newSettings },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Update settings error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (!["ADMIN", "SUPER_ADMIN"].includes(user.role) || !user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action, cidr, label, rangeId, maxLevel, archiveGraduates } = body as Record<string, any>;

    const org = await db.organization.findUnique({
      where: { id: user.organizationId },
      select: { id: true, settings: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    if (action === "addIpRange") {
      if (!cidr || !label) {
        return NextResponse.json({ error: "CIDR and label required" }, { status: 400 });
      }

      const range = await db.trustedIpRange.create({
        data: {
          organizationId: user.organizationId,
          cidr,
          label,
        },
      });
      return NextResponse.json(range, { status: 201 });
    }

    if (action === "removeIpRange") {
      if (!rangeId) {
        return NextResponse.json({ error: "Range ID required" }, { status: 400 });
      }

      await db.trustedIpRange.delete({ where: { id: rangeId } });
      return NextResponse.json({ success: true });
    }

    if (action === "advanceSemester") {
      const currentSettings = getOrganizationSettings(org.settings);
      const academicCalendar = getAcademicCalendarSettings(currentSettings);
      const nextSemester = academicCalendar.currentSemester === 1 ? 2 : 1;
      const nextCycleYear =
        nextSemester === 1
          ? (academicCalendar.cycleYear ?? new Date().getFullYear()) + 1
          : (academicCalendar.cycleYear ?? new Date().getFullYear());

      const updatedSettings = deepMerge(currentSettings, {
        academicCalendar: {
          ...academicCalendar,
          currentSemester: nextSemester,
          cycleYear: nextCycleYear,
          examMode: false,
        },
      });

      const updated = await db.organization.update({
        where: { id: user.organizationId },
        data: { settings: updatedSettings },
        select: { settings: true },
      });

      return NextResponse.json({
        success: true,
        action: "advanceSemester",
        academicCalendar: getAcademicCalendarSettings(updated.settings),
      });
    }

    if (action === "promoteAcademicLevels") {
      const currentSettings = getOrganizationSettings(org.settings);
      const progression = getAcademicProgressionSettings(currentSettings);
      const maxLevelNumber = Number(maxLevel);
      const selectedMaxLevel =
        Number.isFinite(maxLevelNumber) && maxLevelNumber >= 100 ? maxLevelNumber : progression.maxLevel;
      const archive = typeof archiveGraduates === "boolean" ? archiveGraduates : progression.archiveGraduates;

      const promotion = await db.$transaction(async (tx) => {
        const cohorts = await tx.cohort.findMany({
          where: { organizationId: user.organizationId },
          select: {
            id: true,
            department: true,
            level: true,
            groupCode: true,
            displayName: true,
          },
        });

        const cohortByKey = new Map<string, { id: string; level: number }>();
        for (const cohort of cohorts) {
          const key = `${cohort.department}|${cohort.level}|${cohort.groupCode}`;
          cohortByKey.set(key, { id: cohort.id, level: cohort.level });
        }

        let createdCohorts = 0;
        let promotedStudents = 0;

        for (const cohort of cohorts) {
          if (cohort.level >= selectedMaxLevel) continue;

          const targetLevel = cohort.level + 100;
          const targetKey = `${cohort.department}|${targetLevel}|${cohort.groupCode}`;
          let target = cohortByKey.get(targetKey);

          if (!target) {
            const created = await tx.cohort.create({
              data: {
                organizationId: user.organizationId,
                department: cohort.department,
                level: targetLevel,
                groupCode: cohort.groupCode,
                displayName: `${cohort.department} ${targetLevel} ${cohort.groupCode}`,
              },
              select: { id: true, level: true },
            });
            target = created;
            cohortByKey.set(targetKey, target);
            createdCohorts += 1;
          }

          const promoted = await tx.user.updateMany({
            where: {
              organizationId: user.organizationId,
              role: "STUDENT",
              cohortId: cohort.id,
            },
            data: {
              cohortId: target.id,
            },
          });
          promotedStudents += promoted.count;
        }

        let archivedGraduates = 0;
        if (archive) {
          const graduateCohorts = cohorts.filter((cohort) => cohort.level >= selectedMaxLevel);
          for (const cohort of graduateCohorts) {
            const archived = await tx.user.updateMany({
              where: {
                organizationId: user.organizationId,
                role: "STUDENT",
                cohortId: cohort.id,
              },
              data: {
                cohortId: null,
              },
            });
            archivedGraduates += archived.count;
          }
        }

        const updatedSettings = deepMerge(currentSettings, {
          academicProgression: {
            maxLevel: selectedMaxLevel,
            archiveGraduates: archive,
          },
        });

        const updatedOrg = await tx.organization.update({
          where: { id: user.organizationId },
          data: { settings: updatedSettings },
          select: { settings: true },
        });

        return {
          promotedStudents,
          archivedGraduates,
          createdCohorts,
          settings: updatedOrg.settings,
        };
      });

      return NextResponse.json({
        success: true,
        action: "promoteAcademicLevels",
        promotedStudents: promotion.promotedStudents,
        archivedGraduates: promotion.archivedGraduates,
        createdCohorts: promotion.createdCohorts,
        academicProgression: getAcademicProgressionSettings(promotion.settings),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Settings action error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
