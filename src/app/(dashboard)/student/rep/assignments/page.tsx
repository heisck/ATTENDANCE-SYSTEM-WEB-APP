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

type Assignment = {
  id: string;
  title: string;
  body: string;
  dueAt: string;
  cohortId: string | null;
  courseId: string | null;
  submissionNote: string | null;
  isGroupAssignment: boolean;
  cohort?: { displayName: string } | null;
  course?: { code: string; name: string } | null;
  attachments?: Array<{ id: string }>;
};

export default function CourseRepAssignmentsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [form, setForm] = useState({
    cohortId: "",
    courseId: "",
    title: "",
    body: "",
    dueAt: "",
    submissionNote: "",
    isGroupAssignment: false,
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
        const assignmentsRes = await fetch("/api/course-rep/assignments", { cache: "no-store" });
        const assignmentsData = await assignmentsRes.json();
        if (!assignmentsRes.ok) throw new Error(assignmentsData.error || "Unable to load assignments");
        setAssignments(assignmentsData.announcements || []);
      } else {
        setAssignments([]);
      }

      const firstCohort = nextScopes.find((scope) => scope.cohortId)?.cohortId || "";
      const firstCourse = nextScopes.find((scope) => scope.courseId)?.courseId || "";
      setForm((prev) => ({
        ...prev,
        cohortId: prev.cohortId || firstCohort,
        courseId: prev.courseId || firstCourse,
      }));
    } catch (error: any) {
      toast.error(error?.message || "Failed to load assignment tools");
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
        title: form.title,
        body: form.body,
        dueAt: new Date(form.dueAt).toISOString(),
        submissionNote: form.submissionNote || undefined,
        isGroupAssignment: form.isGroupAssignment,
      };

      const response = await fetch("/api/course-rep/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create assignment");

      toast.success("Assignment published");
      setForm((prev) => ({
        ...prev,
        title: "",
        body: "",
        dueAt: "",
        submissionNote: "",
        isGroupAssignment: false,
      }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create assignment");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const response = await fetch(`/api/course-rep/assignments/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete assignment");
      toast.success("Assignment removed");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete assignment");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Course Rep Tools"
        title="Manage Assignments"
        description="Post assignment announcements and publish due dates."
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
        <FieldInput
          label="Title"
          value={form.title}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, title: value }))}
        />
        <FieldInput
          label="Due At"
          type="datetime-local"
          value={form.dueAt}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, dueAt: value }))}
        />
        <div className="sm:col-span-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Assignment Body
          </label>
          <textarea
            required
            value={form.body}
            onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={5}
          />
        </div>
        <div className="sm:col-span-2">
          <FieldInput
            label="Submission Note"
            value={form.submissionNote}
            onChange={(value) => setForm((prev) => ({ ...prev, submissionNote: value }))}
          />
        </div>
        <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isGroupAssignment}
            onChange={(event) => setForm((prev) => ({ ...prev, isGroupAssignment: event.target.checked }))}
          />
          Group assignment
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving || loading || !enabled}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Publish Assignment
          </button>
        </div>
      </form>

      <AttendanceTable
        columns={[
          { key: "title", label: "Title" },
          { key: "course", label: "Course" },
          { key: "cohort", label: "Cohort" },
          { key: "dueAt", label: "Due At" },
          { key: "attachments", label: "Files" },
          { key: "actions", label: "Actions" },
        ]}
        data={assignments.map((assignment) => ({
          title: assignment.title,
          course: assignment.course ? `${assignment.course.code} - ${assignment.course.name}` : "-",
          cohort: assignment.cohort?.displayName || "-",
          dueAt: new Date(assignment.dueAt).toLocaleString(),
          attachments: assignment.attachments?.length || 0,
          actions: (
            <button
              type="button"
              onClick={() => void handleDelete(assignment.id)}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          ),
        }))}
        emptyMessage={loading ? "Loading..." : "No assignments in your scope."}
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
