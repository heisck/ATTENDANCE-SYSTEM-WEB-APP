import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getClassHubFeatureOverrides,
  getEffectiveFeatureFlags,
  getFeatureFlags,
  getOrganizationSettings,
  type ClassHubFeatureFlags,
} from "@/lib/organization-settings";

const FEATURE_FLAG_KEYS = ["studentHubCore", "courseRepTools", "examHub", "groupFormation"] as const;

function normalizeFeatureFlagPatch(value: unknown): ClassHubFeatureFlags {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const patch = value as Record<string, unknown>;
  const output: ClassHubFeatureFlags = {};
  for (const key of FEATURE_FLAG_KEYS) {
    if (typeof patch[key] === "boolean") {
      output[key] = patch[key];
    }
  }
  return output;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = user.organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization found" }, { status: 400 });
  }

  const { id } = await params;
  const classGroup = await db.cohort.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, displayName: true },
  });
  if (!classGroup) {
    return NextResponse.json({ error: "Class group not found" }, { status: 404 });
  }

  const organization = await db.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  if (!organization) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const settings = organization.settings;
  return NextResponse.json({
    classGroup,
    organizationFeatureFlags: getFeatureFlags(settings),
    classFeatureOverrides: getClassHubFeatureOverrides(settings, id),
    effectiveFeatureFlags: getEffectiveFeatureFlags(settings, id),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as any;
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = user.organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization found" }, { status: 400 });
  }

  const { id } = await params;
  const classGroup = await db.cohort.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, displayName: true },
  });
  if (!classGroup) {
    return NextResponse.json({ error: "Class group not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const patch = normalizeFeatureFlagPatch((body as any)?.featureFlags);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "featureFlags patch is required" }, { status: 400 });
  }

  const organization = await db.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  if (!organization) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const currentSettings = getOrganizationSettings(organization.settings);
  const rawMapValue = currentSettings.classHubGovernance;
  const classHubGovernance =
    rawMapValue && typeof rawMapValue === "object" && !Array.isArray(rawMapValue)
      ? { ...(rawMapValue as Record<string, unknown>) }
      : {};
  const currentEntry =
    classHubGovernance[id] && typeof classHubGovernance[id] === "object" && !Array.isArray(classHubGovernance[id])
      ? (classHubGovernance[id] as Record<string, unknown>)
      : {};
  const currentFeatureFlags =
    currentEntry.featureFlags && typeof currentEntry.featureFlags === "object" && !Array.isArray(currentEntry.featureFlags)
      ? (currentEntry.featureFlags as Record<string, unknown>)
      : {};

  classHubGovernance[id] = {
    ...currentEntry,
    featureFlags: {
      ...currentFeatureFlags,
      ...patch,
    },
    updatedAt: new Date().toISOString(),
    updatedByUserId: user.id,
  };

  const updated = await db.organization.update({
    where: { id: orgId },
    data: {
      settings: {
        ...currentSettings,
        classHubGovernance,
      } as Prisma.InputJsonValue,
    },
    select: { settings: true },
  });

  return NextResponse.json({
    classGroup,
    organizationFeatureFlags: getFeatureFlags(updated.settings),
    classFeatureOverrides: getClassHubFeatureOverrides(updated.settings, id),
    effectiveFeatureFlags: getEffectiveFeatureFlags(updated.settings, id),
  });
}
