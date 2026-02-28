"use client";

import { FormEvent, useMemo, useState } from "react";
import { Loader2, RefreshCcw, Save, TrendingUp } from "lucide-react";
import { toast } from "sonner";
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
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>
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
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Current Semester
            </span>
            <select
              value={String(academicCalendar.currentSemester)}
              onChange={(event) =>
                setAcademicCalendar((prev) => ({
                  ...prev,
                  currentSemester: event.target.value === "2" ? 2 : 1,
                }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            >
              <option value="1">Semester 1</option>
              <option value="2">Semester 2</option>
            </select>
          </label>
          <ToggleField
            label="Exam Mode Active"
            checked={academicCalendar.examMode}
            onChange={(checked) => setAcademicCalendar((prev) => ({ ...prev, examMode: checked }))}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void advanceSemester()}
            disabled={advancingSemester}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {advancingSemester ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Advance Semester
          </button>
        </div>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Academic Progression
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Max Level</span>
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
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
          <ToggleField
            label="Archive Graduates on Promotion"
            checked={academicProgression.archiveGraduates}
            onChange={(checked) => setAcademicProgression((prev) => ({ ...prev, archiveGraduates: checked }))}
          />
        </div>
        <button
          type="button"
          onClick={() => void promoteAcademicLevels()}
          disabled={promotingLevels}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {promotingLevels ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          Increase Academic Levels
        </button>
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
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Payment Amount
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={billing.paymentAmount}
              onChange={(event) =>
                setBilling((prev) => ({ ...prev, paymentAmount: Math.max(0, Number(event.target.value || 0)) }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Currency</span>
            <input
              value={billing.paymentCurrency}
              onChange={(event) => setBilling((prev) => ({ ...prev, paymentCurrency: event.target.value }))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 uppercase"
              maxLength={5}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Trial Starts At
            </span>
            <input
              type="datetime-local"
              value={trialStartsAtInput}
              onChange={(event) => setTrialStartsAtInput(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Trial Ends At
            </span>
            <input
              type="datetime-local"
              value={trialEndsAtInput}
              onChange={(event) => setTrialEndsAtInput(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
            />
          </label>
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
    <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/30 px-3 py-2 text-sm">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
    </label>
  );
}
