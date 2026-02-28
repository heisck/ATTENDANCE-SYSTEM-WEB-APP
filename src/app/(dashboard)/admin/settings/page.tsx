import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StudentHubGovernanceForm } from "@/components/admin/student-hub-governance-form";
import {
  getAcademicCalendarSettings,
  getAcademicProgressionSettings,
  getFeatureFlags,
  getStudentHubBillingSettings,
} from "@/lib/organization-settings";

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).organizationId;
  if (!orgId) redirect("/login");

  const org = await db.organization.findUnique({
    where: { id: orgId },
    include: { subscription: true },
  });

  if (!org) redirect("/login");

  const settings = org.settings as any;
  const featureFlags = getFeatureFlags(settings);
  const academicCalendar = getAcademicCalendarSettings(settings);
  const academicProgression = getAcademicProgressionSettings(settings);
  const studentHubBilling = getStudentHubBillingSettings(settings);
  const settingRows: Array<{ label: string; value: string }> = [
    { label: "Campus latitude", value: settings?.campusLat ? String(settings.campusLat) : "Not set" },
    { label: "Campus longitude", value: settings?.campusLng ? String(settings.campusLng) : "Not set" },
    { label: "Default radius", value: `${settings?.defaultRadiusMeters || 500}m` },
    { label: "Confidence threshold", value: `${settings?.confidenceThreshold || 70}%` },
    { label: "Timezone", value: settings?.timezone || "UTC" },
    {
      label: "Student email domains",
      value:
        Array.isArray(settings?.studentEmailDomains) && settings.studentEmailDomains.length > 0
          ? settings.studentEmailDomains.join(", ")
          : "Not configured",
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Configure your university attendance environment."
      />

      <div className="space-y-6">
        <SettingsSection
          title="Organization"
          description="Identity and domain values used across your tenant."
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <InfoItem label="Name" value={org.name} />
            <InfoItem label="Slug" value={org.slug} />
            <InfoItem label="Domain" value={org.domain || "Not set"} />
          </dl>
        </SettingsSection>

        <SettingsSection
          title="Attendance Defaults"
          description="Core GPS and confidence thresholds used for marking attendance."
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            {settingRows.map((row) => (
              <InfoItem key={row.label} label={row.label} value={row.value} />
            ))}
          </dl>
        </SettingsSection>

        <SettingsSection
          title="Student Hub Governance"
          description="Configure module availability, academic calendar state, and trial/payment lock behavior."
        >
          <StudentHubGovernanceForm
            initialFeatureFlags={featureFlags}
            initialAcademicCalendar={academicCalendar}
            initialAcademicProgression={academicProgression}
            initialBilling={studentHubBilling}
          />
        </SettingsSection>

        <SettingsSection
          title="Subscription"
          description="Current plan limits for this institution."
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <InfoItem label="Plan" value={org.subscription?.plan || "FREE"} />
            <InfoItem label="Max students" value={String(org.subscription?.maxStudents || 100)} />
            <InfoItem label="Max courses" value={String(org.subscription?.maxCourses || 10)} />
          </dl>
        </SettingsSection>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border/70 pt-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,210px)_1fr] lg:gap-6">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div>{children}</div>
      </div>
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
