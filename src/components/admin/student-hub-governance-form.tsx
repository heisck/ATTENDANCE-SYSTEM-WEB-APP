"use client";

import { FormEvent, useMemo, useState } from "react";
import { RefreshCcw, Save, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import {
  DashboardActionButton,
  DashboardBinaryChoiceField,
  DashboardFieldCard,
} from "@/components/dashboard/dashboard-controls";
import type {
  AcademicCalendarSettings,
  AcademicProgressionSettings,
  FeatureFlags,
  StudentHubBillingSettings,
} from "@/lib/organization-settings";

function toLocalDateTimeInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

type StudentHubGovernanceFormProps = {
  initialFeatureFlags: FeatureFlags;
  initialAcademicCalendar: AcademicCalendarSettings;
  initialAcademicProgression: AcademicProgressionSettings;
  initialBilling: StudentHubBillingSettings;
};

export function StudentHubGovernanceForm({
  initialFeatureFlags,
  initialAcademicCalendar,
  initialAcademicProgression,
  initialBilling,
}: StudentHubGovernanceFormProps) {
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(initialFeatureFlags);
  const [academicCalendar, setAcademicCalendar] = useState<AcademicCalendarSettings>(initialAcademicCalendar);
  const [academicProgression, setAcademicProgression] = useState<AcademicProgressionSettings>(
    initialAcademicProgression
  );
  const [trialStartsAtInput, setTrialStartsAtInput] = useState<string>(
    toLocalDateTimeInput(initialBilling.trialStartsAt)
  );
  const [trialEndsAtInput, setTrialEndsAtInput] = useState<string>(toLocalDateTimeInput(initialBilling.trialEndsAt));
  const [billing, setBilling] = useState<Omit<StudentHubBillingSettings, "trialStartsAt" | "trialEndsAt">>({
    paymentRequired: initialBilling.paymentRequired,
    paymentAmount: initialBilling.paymentAmount,
    paymentCurrency: initialBilling.paymentCurrency,
    paymentActive: initialBilling.paymentActive,
    lockAfterTrial: initialBilling.lockAfterTrial,
  });

  const [saving, setSaving] = useState(false);
  const [advancingSemester, setAdvancingSemester] = useState(false);
  const [promotingLevels, setPromotingLevels] = useState(false);

  const trialWindowState = useMemo(() => {
    const startsAt = fromLocalDateTimeInput(trialStartsAtInput);
    const endsAt = fromLocalDateTimeInput(trialEndsAtInput);
    if (!endsAt) return "No trial end configured";
    const now = Date.now();
    if (startsAt) {
      const startAt = new Date(startsAt).getTime();
      if (now < startAt) return "Trial not started";
    }
    const endAt = new Date(endsAt).getTime();
    if (now <= endAt) return "Trial active";
    return "Trial ended";
  }, [trialEndsAtInput, trialStartsAtInput]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        settings: {
          featureFlags,
          academicCalendar,
          academicProgression,
          studentHubBilling: {
            ...billing,
            trialStartsAt: fromLocalDateTimeInput(trialStartsAtInput),
            trialEndsAt: fromLocalDateTimeInput(trialEndsAtInput),
          },
        },
      };

      const response = await fetch("/api/organizations/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save organization settings");
      }

      toast.success("Organization settings updated");
    } catch (error: any) {
      toast.error(error?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function advanceSemester() {
    setAdvancingSemester(true);
    try {
      const response = await fetch("/api/organizations/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "advanceSemester" }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to advance semester");
      }

      if (data?.academicCalendar) {
        setAcademicCalendar(data.academicCalendar);
      }
      toast.success("Semester advanced successfully");
    } catch (error: any) {
      toast.error(error?.message || "Unable to advance semester");
    } finally {
      setAdvancingSemester(false);
    }
  }

  async function promoteAcademicLevels() {
    setPromotingLevels(true);
    try {
      const response = await fetch("/api/organizations/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "promoteAcademicLevels",
          maxLevel: academicProgression.maxLevel,
          archiveGraduates: academicProgression.archiveGraduates,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to promote academic levels");
      }

      if (data?.academicProgression) {
        setAcademicProgression(data.academicProgression);
      }
      toast.success(
        `Promoted ${Number(data?.promotedStudents || 0)} students` +
          (Number(data?.archivedGraduates || 0) > 0 ? `, archived ${data.archivedGraduates}` : "")
      );
    } catch (error: any) {
      toast.error(error?.message || "Unable to promote academic levels");
    } finally {
      setPromotingLevels(false);
    }
  }

  return (
    <form onSubmit={saveSettings} className="surface space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Student Hub Governance</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Control module enablement, academic calendar behavior, and trial/payment access for this organization.
          </p>
        </div>
        <DashboardActionButton
          type="submit"
          disabled={saving}
          variant="primary"
          icon={Save}
          loading={saving}
        >
          Save Settings
        </DashboardActionButton>
      </div>

      <section className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Hub Modules</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleField
            label="Enable Student Hub Core"
            checked={featureFlags.studentHubCore}
            onChange={(checked) => setFeatureFlags((prev) => ({ ...prev, studentHubCore: checked }))}
          />
          <ToggleField
            label="Enable Course Rep Tools"
            checked={featureFlags.courseRepTools}
            onChange={(checked) => setFeatureFlags((prev) => ({ ...prev, courseRepTools: checked }))}
          />
          <ToggleField
            label="Enable Exam Hub"
            checked={featureFlags.examHub}
            onChange={(checked) => setFeatureFlags((prev) => ({ ...prev, examHub: checked }))}
          />
          <ToggleField
            label="Enable Group Formation"
            checked={featureFlags.groupFormation}
            onChange={(checked) => setFeatureFlags((prev) => ({ ...prev, groupFormation: checked }))}
          />
        </div>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Academic Calendar</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <DashboardFieldCard label="Current Semester">
            <select
              value={String(academicCalendar.currentSemester)}
              onChange={(event) =>
                setAcademicCalendar((prev) => ({
                  ...prev,
                  currentSemester: event.target.value === "2" ? 2 : 1,
                }))
              }
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="1">Semester 1</option>
              <option value="2">Semester 2</option>
            </select>
          </DashboardFieldCard>
          <ToggleField
            label="Exam Mode Active"
            checked={academicCalendar.examMode}
            onChange={(checked) => setAcademicCalendar((prev) => ({ ...prev, examMode: checked }))}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <DashboardActionButton
            type="button"
            onClick={() => void advanceSemester()}
            disabled={advancingSemester}
            icon={RefreshCcw}
            loading={advancingSemester}
          >
            Advance Semester
          </DashboardActionButton>
        </div>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Academic Progression
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <DashboardFieldCard label="Max Level">
            <input
              type="number"
              min={100}
              step={100}
              value={academicProgression.maxLevel}
              onChange={(event) =>
                setAcademicProgression((prev) => ({
                  ...prev,
                  maxLevel: Math.max(100, Number(event.target.value || 400)),
                }))
              }
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </DashboardFieldCard>
          <ToggleField
            label="Archive Graduates on Promotion"
            checked={academicProgression.archiveGraduates}
            onChange={(checked) => setAcademicProgression((prev) => ({ ...prev, archiveGraduates: checked }))}
          />
        </div>
        <DashboardActionButton
          type="button"
          onClick={() => void promoteAcademicLevels()}
          disabled={promotingLevels}
          icon={TrendingUp}
          loading={promotingLevels}
        >
          Increase Academic Levels
        </DashboardActionButton>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Trial and Payment Gating
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleField
            label="Payment Required for Student Hub"
            checked={billing.paymentRequired}
            onChange={(checked) => setBilling((prev) => ({ ...prev, paymentRequired: checked }))}
          />
          <ToggleField
            label="Payment Active"
            checked={billing.paymentActive}
            onChange={(checked) => setBilling((prev) => ({ ...prev, paymentActive: checked }))}
          />
          <ToggleField
            label="Lock Hub after Trial when Unpaid"
            checked={billing.lockAfterTrial}
            onChange={(checked) => setBilling((prev) => ({ ...prev, lockAfterTrial: checked }))}
          />
          <DashboardFieldCard label="Payment Amount">
            <input
              type="number"
              min={0}
              step="0.01"
              value={billing.paymentAmount}
              onChange={(event) =>
                setBilling((prev) => ({ ...prev, paymentAmount: Math.max(0, Number(event.target.value || 0)) }))
              }
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </DashboardFieldCard>
          <DashboardFieldCard label="Currency">
            <input
              value={billing.paymentCurrency}
              onChange={(event) => setBilling((prev) => ({ ...prev, paymentCurrency: event.target.value }))}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              maxLength={5}
            />
          </DashboardFieldCard>
          <DashboardFieldCard label="Trial Starts At">
            <input
              type="datetime-local"
              value={trialStartsAtInput}
              onChange={(event) => setTrialStartsAtInput(event.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </DashboardFieldCard>
          <DashboardFieldCard label="Trial Ends At">
            <input
              type="datetime-local"
              value={trialEndsAtInput}
              onChange={(event) => setTrialEndsAtInput(event.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </DashboardFieldCard>
        </div>
        <p className="text-xs text-muted-foreground">Trial status: {trialWindowState}</p>
      </section>
    </form>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <DashboardBinaryChoiceField
      label={label}
      value={checked}
      onChange={onChange}
      trueLabel="Enabled"
      falseLabel="Disabled"
      className="h-full"
    />
  );
}
