import type { Organization } from "@prisma/client";

export type FeatureFlags = {
  studentHubCore: boolean;
  courseRepTools: boolean;
  examHub: boolean;
  groupFormation: boolean;
};

export type AcademicCalendarSettings = {
  currentSemester: 1 | 2;
  examMode: boolean;
  cycleYear: number | null;
};

export type AcademicProgressionSettings = {
  maxLevel: number;
  archiveGraduates: boolean;
};

export type StudentHubBillingSettings = {
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  paymentRequired: boolean;
  paymentAmount: number;
  paymentCurrency: string;
  paymentActive: boolean;
  lockAfterTrial: boolean;
};

export type StudentHubAccessState = {
  accessAllowed: boolean;
  reason: "DISABLED_BY_ADMIN" | "TRIAL_EXPIRED_UNPAID" | null;
  withinTrial: boolean;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  paymentRequired: boolean;
  paymentAmount: number;
  paymentCurrency: string;
  paymentActive: boolean;
  lockAfterTrial: boolean;
};

const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  studentHubCore: false,
  courseRepTools: false,
  examHub: false,
  groupFormation: false,
};

const DEFAULT_ACADEMIC_CALENDAR: AcademicCalendarSettings = {
  currentSemester: 1,
  examMode: false,
  cycleYear: null,
};

const DEFAULT_ACADEMIC_PROGRESSION: AcademicProgressionSettings = {
  maxLevel: 400,
  archiveGraduates: false,
};

const DEFAULT_STUDENT_HUB_BILLING: StudentHubBillingSettings = {
  trialStartsAt: null,
  trialEndsAt: null,
  paymentRequired: false,
  paymentAmount: 5,
  paymentCurrency: "GHS",
  paymentActive: false,
  lockAfterTrial: true,
};

export function getOrganizationSettings(settings: unknown): Record<string, any> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }
  return settings as Record<string, any>;
}

function parseOptionalIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function getFeatureFlags(settings: unknown): FeatureFlags {
  const parsed = getOrganizationSettings(settings);
  const raw = parsed.featureFlags;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_FEATURE_FLAGS;
  }

  return {
    studentHubCore: Boolean((raw as any).studentHubCore),
    courseRepTools: Boolean((raw as any).courseRepTools),
    examHub: Boolean((raw as any).examHub),
    groupFormation: Boolean((raw as any).groupFormation),
  };
}

export function isFeatureEnabled(settings: unknown, key: keyof FeatureFlags): boolean {
  const flags = getFeatureFlags(settings);
  return flags[key];
}

export function getAcademicCalendarSettings(settings: unknown): AcademicCalendarSettings {
  const parsed = getOrganizationSettings(settings);
  const raw = parsed.academicCalendar;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_ACADEMIC_CALENDAR;
  }

  const semester = Number((raw as any).currentSemester);
  const cycleYear = Number((raw as any).cycleYear);

  return {
    currentSemester: semester === 2 ? 2 : 1,
    examMode: Boolean((raw as any).examMode),
    cycleYear: Number.isFinite(cycleYear) ? cycleYear : null,
  };
}

export function getAcademicProgressionSettings(settings: unknown): AcademicProgressionSettings {
  const parsed = getOrganizationSettings(settings);
  const raw = parsed.academicProgression;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_ACADEMIC_PROGRESSION;
  }

  const maxLevelCandidate = Number((raw as any).maxLevel);
  const maxLevel = Number.isFinite(maxLevelCandidate) && maxLevelCandidate >= 100 ? maxLevelCandidate : 400;

  return {
    maxLevel,
    archiveGraduates: Boolean((raw as any).archiveGraduates),
  };
}

export function getStudentHubBillingSettings(settings: unknown): StudentHubBillingSettings {
  const parsed = getOrganizationSettings(settings);
  const raw = parsed.studentHubBilling;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_STUDENT_HUB_BILLING;
  }

  return {
    trialStartsAt: parseOptionalIsoDate((raw as any).trialStartsAt),
    trialEndsAt: parseOptionalIsoDate((raw as any).trialEndsAt),
    paymentRequired: Boolean((raw as any).paymentRequired),
    paymentAmount: parsePositiveNumber((raw as any).paymentAmount, DEFAULT_STUDENT_HUB_BILLING.paymentAmount),
    paymentCurrency:
      typeof (raw as any).paymentCurrency === "string" && (raw as any).paymentCurrency.trim().length > 0
        ? (raw as any).paymentCurrency.trim().toUpperCase()
        : DEFAULT_STUDENT_HUB_BILLING.paymentCurrency,
    paymentActive: Boolean((raw as any).paymentActive),
    lockAfterTrial:
      typeof (raw as any).lockAfterTrial === "boolean"
        ? (raw as any).lockAfterTrial
        : DEFAULT_STUDENT_HUB_BILLING.lockAfterTrial,
  };
}

function computeWithinTrial(billing: StudentHubBillingSettings, now: Date): boolean {
  const start = billing.trialStartsAt ? new Date(billing.trialStartsAt) : null;
  const end = billing.trialEndsAt ? new Date(billing.trialEndsAt) : null;

  if (start && now.getTime() < start.getTime()) {
    return false;
  }
  if (!end) {
    return false;
  }
  return now.getTime() <= end.getTime();
}

export function getStudentHubAccessState(settings: unknown, now: Date = new Date()): StudentHubAccessState {
  const flags = getFeatureFlags(settings);
  const billing = getStudentHubBillingSettings(settings);
  const withinTrial = computeWithinTrial(billing, now);

  let accessAllowed = true;
  let reason: StudentHubAccessState["reason"] = null;

  if (!flags.studentHubCore) {
    accessAllowed = false;
    reason = "DISABLED_BY_ADMIN";
  } else if (billing.paymentRequired) {
    const paid = billing.paymentActive;
    if (!paid && !withinTrial && billing.lockAfterTrial) {
      accessAllowed = false;
      reason = "TRIAL_EXPIRED_UNPAID";
    }
  }

  return {
    accessAllowed,
    reason,
    withinTrial,
    trialStartsAt: billing.trialStartsAt,
    trialEndsAt: billing.trialEndsAt,
    paymentRequired: billing.paymentRequired,
    paymentAmount: billing.paymentAmount,
    paymentCurrency: billing.paymentCurrency,
    paymentActive: billing.paymentActive,
    lockAfterTrial: billing.lockAfterTrial,
  };
}

export function getStudentEmailDomains(settings: unknown, orgDomain?: string | null): string[] {
  const parsed = getOrganizationSettings(settings);
  const fromSettings = Array.isArray(parsed.studentEmailDomains)
    ? parsed.studentEmailDomains.filter((value: unknown) => typeof value === "string")
    : [];

  const normalized = fromSettings
    .map((domain: string) => domain.trim().toLowerCase())
    .filter((domain: string) => domain.length > 0);

  if (normalized.length > 0) {
    return Array.from(new Set(normalized));
  }

  if (orgDomain && orgDomain.trim().length > 0) {
    return [orgDomain.trim().toLowerCase()];
  }

  return [];
}

export function organizationFromSelect(
  org: Pick<Organization, "domain" | "settings"> | null | undefined
): { domains: string[]; featureFlags: FeatureFlags } {
  return {
    domains: getStudentEmailDomains(org?.settings, org?.domain),
    featureFlags: getFeatureFlags(org?.settings),
  };
}
