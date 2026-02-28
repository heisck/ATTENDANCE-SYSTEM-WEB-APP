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

type TimetableEntry = {
  id: string;
  cohortId: string;
  courseId: string | null;
  courseCode: string;
  courseTitle: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  venue: string | null;
  mode: "PHYSICAL" | "ONLINE" | "HYBRID";
  onlineLink: string | null;
  notes: string | null;
  cohort?: { displayName: string } | null;
  course?: { code: string; name: string } | null;
};

const dayOptions = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

export default function CourseRepTimetablePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [form, setForm] = useState({
    cohortId: "",
    courseId: "",
    courseCode: "",
    courseTitle: "",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "10:00",
    venue: "",
    mode: "PHYSICAL",
    onlineLink: "",
    notes: "",
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
        const entriesRes = await fetch("/api/course-rep/timetable", { cache: "no-store" });
        const entriesData = await entriesRes.json();
        if (!entriesRes.ok) throw new Error(entriesData.error || "Unable to load timetable entries");
        setEntries(entriesData.entries || []);
      } else {
        setEntries([]);
      }

      const firstCohort = nextScopes.find((scope) => scope.cohortId)?.cohortId || "";
      const firstCourse = nextScopes.find((scope) => scope.courseId)?.courseId || "";
      setForm((prev) => ({
        ...prev,
        cohortId: prev.cohortId || firstCohort,
        courseId: prev.courseId || firstCourse,
      }));
    } catch (error: any) {
      toast.error(error?.message || "Failed to load timetable tools");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        cohortId: form.cohortId || undefined,
        courseId: form.courseId || undefined,
        courseCode: form.courseCode,
        courseTitle: form.courseTitle,
        dayOfWeek: Number(form.dayOfWeek),
        startTime: form.startTime,
        endTime: form.endTime,
        venue: form.venue || undefined,
        mode: form.mode as "PHYSICAL" | "ONLINE" | "HYBRID",
        onlineLink: form.onlineLink || undefined,
        notes: form.notes || undefined,
      };

      const response = await fetch("/api/course-rep/timetable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create timetable entry");

      toast.success("Timetable entry created");
      setForm((prev) => ({
        ...prev,
        courseCode: "",
        courseTitle: "",
        venue: "",
        onlineLink: "",
        notes: "",
      }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create timetable entry");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const response = await fetch(`/api/course-rep/timetable/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete timetable entry");
      toast.success("Timetable entry removed");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete timetable entry");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Course Rep Tools"
        title="Manage Timetable"
        description="Publish and maintain timetable entries within your assigned scopes."
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
          disabled={loading || !enabled}
          onChange={(value) => setForm((prev) => ({ ...prev, cohortId: value }))}
          options={cohortOptions.map((cohort) => ({ value: cohort.id, label: cohort.displayName }))}
        />
        <FieldSelect
          label="Course (optional)"
          value={form.courseId}
          disabled={loading || !enabled}
          onChange={(value) => setForm((prev) => ({ ...prev, courseId: value }))}
          options={[
            { value: "", label: "None" },
            ...courseOptions.map((course) => ({
              value: course.id,
              label: `${course.code} - ${course.name}`,
            })),
          ]}
        />
        <FieldInput
          label="Course Code"
          value={form.courseCode}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, courseCode: value }))}
        />
        <FieldInput
          label="Course Title"
          value={form.courseTitle}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, courseTitle: value }))}
        />
        <FieldSelect
          label="Day"
          value={`${form.dayOfWeek}`}
          onChange={(value) => setForm((prev) => ({ ...prev, dayOfWeek: Number(value) }))}
          options={dayOptions.map((day) => ({ value: `${day.value}`, label: day.label }))}
        />
        <FieldSelect
          label="Mode"
          value={form.mode}
          onChange={(value) =>
            setForm((prev) => ({ ...prev, mode: value as "PHYSICAL" | "ONLINE" | "HYBRID" }))
          }
          options={[
            { value: "PHYSICAL", label: "Physical" },
            { value: "ONLINE", label: "Online" },
            { value: "HYBRID", label: "Hybrid" },
          ]}
        />
        <FieldInput
          label="Start Time"
          type="time"
          value={form.startTime}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, startTime: value }))}
        />
        <FieldInput
          label="End Time"
          type="time"
          value={form.endTime}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, endTime: value }))}
        />
        <FieldInput
          label="Venue"
          value={form.venue}
          onChange={(value) => setForm((prev) => ({ ...prev, venue: value }))}
        />
        <FieldInput
          label="Online Link"
          type="url"
          value={form.onlineLink}
          onChange={(value) => setForm((prev) => ({ ...prev, onlineLink: value }))}
        />
        <div className="sm:col-span-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Notes
          </label>
          <textarea
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
            Add Timetable Entry
          </button>
        </div>
      </form>

      <AttendanceTable
        columns={[
          { key: "day", label: "Day" },
          { key: "course", label: "Course" },
          { key: "cohort", label: "Cohort" },
          { key: "time", label: "Time" },
          { key: "mode", label: "Mode" },
          { key: "actions", label: "Actions" },
        ]}
        data={entries.map((entry) => ({
          day: dayOptions.find((day) => day.value === entry.dayOfWeek)?.label || entry.dayOfWeek,
          course: entry.course ? `${entry.course.code} - ${entry.course.name}` : `${entry.courseCode} - ${entry.courseTitle}`,
          cohort: entry.cohort?.displayName || "-",
          time: `${entry.startTime} - ${entry.endTime}`,
          mode: entry.mode,
          actions: (
            <button
              type="button"
              onClick={() => void handleDelete(entry.id)}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          ),
        }))}
        emptyMessage={loading ? "Loading..." : "No timetable entries in your scope."}
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
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
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
