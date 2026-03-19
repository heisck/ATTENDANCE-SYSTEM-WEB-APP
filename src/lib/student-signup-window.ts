import { buildAppUrl } from "@/lib/email";
import { getOrganizationSettings } from "@/lib/organization-settings";
import { createExpiryDate, createRawToken, hashToken } from "@/lib/tokens";

type RawStudentSignupWindow = {
  tokenHash?: unknown;
  expiresAt?: unknown;
  department?: unknown;
  level?: unknown;
  groupCode?: unknown;
  requireGroup?: unknown;
  createdAt?: unknown;
  createdByUserId?: unknown;
};

export type StudentSignupWindow = {
  tokenHash: string;
  expiresAt: string;
  department: string | null;
  level: number | null;
  groupCode: string | null;
  requireGroup: boolean;
  createdAt: string | null;
  createdByUserId: string | null;
};

function normalizeOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalLevel(value: unknown) {
  const level = Number(value);
  if (!Number.isFinite(level) || level < 100 || level > 900) {
    return null;
  }

  return Math.trunc(level);
}

function normalizeIsoDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function getStudentSignupWindow(settings: unknown): StudentSignupWindow | null {
  const organizationSettings = getOrganizationSettings(settings);
  const rawWindow = organizationSettings.studentSignupWindow;

  if (!rawWindow || typeof rawWindow !== "object" || Array.isArray(rawWindow)) {
    return null;
  }

  const candidate = rawWindow as RawStudentSignupWindow;
  const tokenHash = normalizeOptionalText(candidate.tokenHash);
  const expiresAt = normalizeIsoDate(candidate.expiresAt);

  if (!tokenHash || !expiresAt) {
    return null;
  }

  return {
    tokenHash,
    expiresAt,
    department: normalizeOptionalText(candidate.department)?.toUpperCase() ?? null,
    level: normalizeOptionalLevel(candidate.level),
    groupCode: normalizeOptionalText(candidate.groupCode)?.toUpperCase() ?? null,
    requireGroup: Boolean(candidate.requireGroup),
    createdAt: normalizeIsoDate(candidate.createdAt),
    createdByUserId: normalizeOptionalText(candidate.createdByUserId),
  };
}

export function isStudentSignupWindowActive(
  window: StudentSignupWindow | null,
  now: Date = new Date()
) {
  if (!window) {
    return false;
  }

  return new Date(window.expiresAt).getTime() > now.getTime();
}

export function getActiveStudentSignupWindow(
  settings: unknown,
  now: Date = new Date()
) {
  const window = getStudentSignupWindow(settings);
  return isStudentSignupWindowActive(window, now) ? window : null;
}

export function validateStudentSignupToken(settings: unknown, rawToken: string) {
  const activeWindow = getActiveStudentSignupWindow(settings);
  if (!activeWindow) {
    return null;
  }

  const normalizedToken = rawToken.trim();
  if (!normalizedToken) {
    return null;
  }

  return hashToken(normalizedToken) === activeWindow.tokenHash ? activeWindow : null;
}

export function createStudentSignupWindow(input: {
  ttlMinutes: number;
  department?: string | null;
  level?: number | null;
  groupCode?: string | null;
  requireGroup?: boolean;
  createdByUserId?: string | null;
}) {
  const rawToken = createRawToken();
  const expiresAt = createExpiryDate(input.ttlMinutes * 60 * 1000);

  return {
    rawToken,
    window: {
      tokenHash: hashToken(rawToken),
      expiresAt: expiresAt.toISOString(),
      department: normalizeOptionalText(input.department)?.toUpperCase() ?? null,
      level: normalizeOptionalLevel(input.level),
      groupCode: normalizeOptionalText(input.groupCode)?.toUpperCase() ?? null,
      requireGroup: Boolean(input.requireGroup),
      createdAt: new Date().toISOString(),
      createdByUserId: normalizeOptionalText(input.createdByUserId),
    },
  };
}

export function clearStudentSignupWindow(settings: unknown) {
  const organizationSettings = getOrganizationSettings(settings);
  const nextSettings = { ...organizationSettings };
  delete nextSettings.studentSignupWindow;
  return nextSettings;
}

export function withStudentSignupWindow(settings: unknown, window: StudentSignupWindow) {
  const organizationSettings = getOrganizationSettings(settings);
  return {
    ...organizationSettings,
    studentSignupWindow: window,
  };
}

export function buildStudentSignupLink(input: {
  organizationSlug: string;
  rawToken: string;
}) {
  const params = new URLSearchParams({
    org: input.organizationSlug,
    token: input.rawToken,
  });
  return buildAppUrl(`/register?${params.toString()}`);
}
