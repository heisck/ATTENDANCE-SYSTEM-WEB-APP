"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

type Scope = {
  id: string;
  cohortId: string | null;
  courseId: string | null;
  cohort?: { id: string; displayName: string } | null;
  course?: { id: string; code: string; name: string } | null;
};

type ClassUpdateItem = {
  id: string;
  type: "CANCELLED" | "RESCHEDULED" | "VENUE_CHANGE" | "ONLINE_LINK" | "TAKEOVER" | "NOTICE";
  title: string;
  message: string;
  effectiveAt: string;
  cohortId: string | null;
  courseId: string | null;
  cohort?: { displayName: string } | null;
  course?: { code: string; name: string } | null;
};

const updateTypes = [
  "CANCELLED",
  "RESCHEDULED",
  "VENUE_CHANGE",
  "ONLINE_LINK",
  "TAKEOVER",
  "NOTICE",
] as const;

export default function CourseRepUpdatesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [updates, setUpdates] = useState<ClassUpdateItem[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [payloadJson, setPayloadJson] = useState("{}");
  const [form, setForm] = useState({
    cohortId: "",
    courseId: "",
    type: "NOTICE",
    title: "",
    message: "",
    effectiveAt: "",
  });

  const cohortOptions = useMemo(
    () =>
      Array.from(
        new Map(
          scopes
            .filter((scope) => scope.cohortId && scope.cohort)
            .map((scope) => [scope.cohortId as string, scope.cohort as { id: string; displayName: string }])
        ).values()
      ),
    [scopes]
  );

  const courseOptions = useMemo(
    () =>
      Array.from(
        new Map(
          scopes
            .filter((scope) => scope.courseId && scope.course)
            .map((scope) => [scope.courseId as string, scope.course as { id: string; code: string; name: string }])
        ).values()
      ),
    [scopes]
  );

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [statusRes, scopeRes] = await Promise.all([
        fetch("/api/auth/student-status", { cache: "no-store" }),
        fetch("/api/student/course-rep/scopes", { cache: "no-store" }),
      ]);

      const statusData = await statusRes.json();
      if (!statusRes.ok) throw new Error(statusData.error || "Unable to load student status");
      const flags = statusData?.featureFlags || {};
      const toolsEnabled = Boolean(flags.studentHubCore) && Boolean(flags.courseRepTools);
      setEnabled(toolsEnabled);

      const scopeData = await scopeRes.json();
      if (!scopeRes.ok) throw new Error(scopeData.error || "Unable to load rep scopes");
      const nextScopes: Scope[] = scopeData.scopes || [];
      setScopes(nextScopes);

      if (toolsEnabled) {
        const updatesRes = await fetch("/api/course-rep/class-updates", { cache: "no-store" });
        const updatesData = await updatesRes.json();
        if (!updatesRes.ok) throw new Error(updatesData.error || "Unable to load class updates");
        setUpdates(updatesData.updates || []);
      } else {
        setUpdates([]);
      }

      const firstCohort = nextScopes.find((scope) => scope.cohortId)?.cohortId || "";
      const firstCourse = nextScopes.find((scope) => scope.courseId)?.courseId || "";
      setForm((prev) => ({
        ...prev,
        cohortId: prev.cohortId || firstCohort,
        courseId: prev.courseId || firstCourse,
      }));
    } catch (error: any) {
      toast.error(error?.message || "Failed to load update tools");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      let parsedPayload: Record<string, any> = {};
      try {
        parsedPayload = JSON.parse(payloadJson || "{}");
      } catch {
        throw new Error("Payload must be valid JSON");
      }

      const payload = {
        cohortId: form.cohortId || undefined,
        courseId: form.courseId || undefined,
        type: form.type,
        title: form.title,
        message: form.message,
        effectiveAt: new Date(form.effectiveAt).toISOString(),
        payload: parsedPayload,
      };

      const response = await fetch("/api/course-rep/class-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create class update");

      toast.success("Class update published");
      setForm((prev) => ({ ...prev, title: "", message: "" }));
      setPayloadJson("{}");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create class update");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const response = await fetch(`/api/course-rep/class-updates/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete class update");
      toast.success("Class update archived");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete class update");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Course Rep Tools"
        title="Manage Class Updates"
        description="Post cancellations, reschedules, venue changes, and notices."
      />

      {!enabled ? (
        <div className="surface p-4 text-sm text-muted-foreground">
          Course Rep tools are disabled for this organization.
        </div>
      ) : null}

      <form onSubmit={handleCreate} className="surface grid gap-4 p-4 sm:grid-cols-2">
        <FieldSelect
          label="Cohort"
          value={form.cohortId}
          onChange={(value) => setForm((prev) => ({ ...prev, cohortId: value }))}
          options={cohortOptions.map((cohort) => ({ value: cohort.id, label: cohort.displayName }))}
        />
        <FieldSelect
          label="Course (optional)"
          value={form.courseId}
          onChange={(value) => setForm((prev) => ({ ...prev, courseId: value }))}
          options={[
            { value: "", label: "None" },
            ...courseOptions.map((course) => ({
              value: course.id,
              label: `${course.code} - ${course.name}`,
            })),
          ]}
        />
        <FieldSelect
          label="Update Type"
          value={form.type}
          onChange={(value) => setForm((prev) => ({ ...prev, type: value }))}
          options={updateTypes.map((type) => ({ value: type, label: type }))}
        />
        <FieldInput
          label="Effective At"
          type="datetime-local"
          value={form.effectiveAt}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, effectiveAt: value }))}
        />
        <FieldInput
          label="Title"
          value={form.title}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, title: value }))}
        />
        <div className="sm:col-span-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Message
          </label>
          <textarea
            required
            value={form.message}
            onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={4}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Payload (JSON)
          </label>
          <textarea
            value={payloadJson}
            onChange={(event) => setPayloadJson(event.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            rows={3}
          />
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving || loading || !enabled}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Publish Update
          </button>
        </div>
      </form>

      <AttendanceTable
        columns={[
          { key: "type", label: "Type" },
          { key: "title", label: "Title" },
          { key: "course", label: "Course" },
          { key: "cohort", label: "Cohort" },
          { key: "effective", label: "Effective At" },
          { key: "actions", label: "Actions" },
        ]}
        data={updates.map((update) => ({
          type: update.type,
          title: update.title,
          course: update.course ? `${update.course.code} - ${update.course.name}` : "-",
          cohort: update.cohort?.displayName || "-",
          effective: new Date(update.effectiveAt).toLocaleString(),
          actions: (
            <button
              type="button"
              onClick={() => void handleDelete(update.id)}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          ),
        }))}
        emptyMessage={loading ? "Loading..." : "No class updates in your scope."}
      />
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  required = false,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      />
    </label>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        {options.map((option) => (
          <option key={option.value || `${label}-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
