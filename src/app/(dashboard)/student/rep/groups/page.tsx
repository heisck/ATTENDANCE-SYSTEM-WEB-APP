"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Shuffle } from "lucide-react";
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

type GroupSession = {
  id: string;
  title: string | null;
  mode: "SELF_SELECT" | "RANDOM_ASSIGNMENT";
  leaderMode: "VOLUNTEER_VOTE" | "VOLUNTEER_FIRST_COME" | "RANDOM";
  startsAt: string;
  endsAt: string;
  groupSize: number;
  active: boolean;
  cohort?: { displayName: string } | null;
  course?: { code: string; name: string } | null;
  groups: Array<{
    id: string;
    name: string;
    capacity: number;
    _count: { memberships: number };
  }>;
};

export default function CourseRepGroupsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [sessions, setSessions] = useState<GroupSession[]>([]);
  const [groupName, setGroupName] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    cohortId: "",
    courseId: "",
    title: "",
    groupSize: 5,
    mode: "SELF_SELECT",
    leaderMode: "VOLUNTEER_VOTE",
    startsAt: "",
    endsAt: "",
    active: true,
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
      const toolsEnabled =
        Boolean(flags.studentHubCore) && Boolean(flags.courseRepTools) && Boolean(flags.groupFormation);
      setEnabled(toolsEnabled);

      const scopeData = await scopeRes.json();
      if (!scopeRes.ok) throw new Error(scopeData.error || "Unable to load rep scopes");
      const nextScopes: Scope[] = scopeData.scopes || [];
      setScopes(nextScopes);

      if (toolsEnabled) {
        const sessionsRes = await fetch("/api/course-rep/group-sessions", { cache: "no-store" });
        const sessionsData = await sessionsRes.json();
        if (!sessionsRes.ok) throw new Error(sessionsData.error || "Unable to load group sessions");
        setSessions(sessionsData.sessions || []);
      } else {
        setSessions([]);
      }

      const firstCohort = nextScopes.find((scope) => scope.cohortId)?.cohortId || "";
      const firstCourse = nextScopes.find((scope) => scope.courseId)?.courseId || "";
      setForm((prev) => ({
        ...prev,
        cohortId: prev.cohortId || firstCohort,
        courseId: prev.courseId || firstCourse,
      }));
    } catch (error: any) {
      toast.error(error?.message || "Failed to load group tools");
    } finally {
      setLoading(false);
    }
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        cohortId: form.cohortId || undefined,
        courseId: form.courseId || undefined,
        title: form.title || undefined,
        groupSize: Number(form.groupSize),
        mode: form.mode,
        leaderMode: form.leaderMode,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        active: form.active,
      };
      const response = await fetch("/api/course-rep/group-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create group session");
      toast.success("Group session created");
      setForm((prev) => ({
        ...prev,
        title: "",
        startsAt: "",
        endsAt: "",
      }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create group session");
    } finally {
      setSaving(false);
    }
  }

  async function createGroup(sessionId: string) {
    const name = (groupName[sessionId] || "").trim();
    if (!name) {
      toast.error("Enter group name");
      return;
    }
    try {
      const response = await fetch(`/api/course-rep/group-sessions/${sessionId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create group");
      toast.success("Group created");
      setGroupName((prev) => ({ ...prev, [sessionId]: "" }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create group");
    }
  }

  async function autoAssign(sessionId: string) {
    try {
      const response = await fetch(`/api/course-rep/group-sessions/${sessionId}/auto-assign`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to auto-assign students");
      toast.success(`Auto-assigned ${data.assigned || 0} students`);
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to auto-assign students");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Course Rep Tools"
        title="Manage Group Formation"
        description="Create group sessions, configure modes, and assign students."
      />

      {!enabled ? (
        <div className="surface p-4 text-sm text-muted-foreground">
          Group formation tools are disabled for this organization.
        </div>
      ) : null}

      <form onSubmit={createSession} className="surface grid gap-4 p-4 sm:grid-cols-2">
        <FieldSelect
          label="Cohort"
          value={form.cohortId}
          onChange={(value) => setForm((prev) => ({ ...prev, cohortId: value }))}
          options={cohortOptions.map((cohort) => ({ value: cohort.id, label: cohort.displayName }))}
        />
        <FieldSelect
          label="Course"
          value={form.courseId}
          onChange={(value) => setForm((prev) => ({ ...prev, courseId: value }))}
          options={courseOptions.map((course) => ({
            value: course.id,
            label: `${course.code} - ${course.name}`,
          }))}
        />
        <FieldInput
          label="Title"
          value={form.title}
          onChange={(value) => setForm((prev) => ({ ...prev, title: value }))}
        />
        <FieldInput
          label="Group Size"
          type="number"
          value={`${form.groupSize}`}
          onChange={(value) => setForm((prev) => ({ ...prev, groupSize: Number(value) }))}
        />
        <FieldSelect
          label="Mode"
          value={form.mode}
          onChange={(value) =>
            setForm((prev) => ({ ...prev, mode: value as "SELF_SELECT" | "RANDOM_ASSIGNMENT" }))
          }
          options={[
            { value: "SELF_SELECT", label: "SELF_SELECT" },
            { value: "RANDOM_ASSIGNMENT", label: "RANDOM_ASSIGNMENT" },
          ]}
        />
        <FieldSelect
          label="Leader Mode"
          value={form.leaderMode}
          onChange={(value) =>
            setForm((prev) => ({
              ...prev,
              leaderMode: value as "VOLUNTEER_VOTE" | "VOLUNTEER_FIRST_COME" | "RANDOM",
            }))
          }
          options={[
            { value: "VOLUNTEER_VOTE", label: "VOLUNTEER_VOTE" },
            { value: "VOLUNTEER_FIRST_COME", label: "VOLUNTEER_FIRST_COME" },
            { value: "RANDOM", label: "RANDOM" },
          ]}
        />
        <FieldInput
          label="Starts At"
          type="datetime-local"
          value={form.startsAt}
          onChange={(value) => setForm((prev) => ({ ...prev, startsAt: value }))}
          required
        />
        <FieldInput
          label="Ends At"
          type="datetime-local"
          value={form.endsAt}
          onChange={(value) => setForm((prev) => ({ ...prev, endsAt: value }))}
          required
        />
        <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
          />
          Active session
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving || loading || !enabled}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Group Session
          </button>
        </div>
      </form>

      <AttendanceTable
        columns={[
          { key: "scope", label: "Scope" },
          { key: "window", label: "Window" },
          { key: "config", label: "Config" },
          { key: "groups", label: "Groups" },
          { key: "actions", label: "Actions" },
        ]}
        data={sessions.map((session) => ({
          scope: session.course
            ? `${session.course.code} - ${session.course.name}`
            : session.cohort?.displayName || "-",
          window: `${new Date(session.startsAt).toLocaleString()} -> ${new Date(session.endsAt).toLocaleString()}`,
          config: `${session.mode} | leader: ${session.leaderMode} | size ${session.groupSize}`,
          groups: (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{session.groups.length} groups</p>
              <div className="flex items-center gap-1">
                <input
                  value={groupName[session.id] || ""}
                  onChange={(event) =>
                    setGroupName((prev) => ({ ...prev, [session.id]: event.target.value }))
                  }
                  placeholder="Group name"
                  className="h-7 min-w-36 rounded-md border border-input bg-background px-2 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => void createGroup(session.id)}
                  className="h-7 rounded-md border border-border px-2 text-[11px]"
                >
                  Add
                </button>
              </div>
            </div>
          ),
          actions: session.mode === "RANDOM_ASSIGNMENT" ? (
            <button
              type="button"
              onClick={() => void autoAssign(session.id)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Auto-Assign
            </button>
          ) : (
            "-"
          ),
        }))}
        emptyMessage={loading ? "Loading..." : "No group sessions in your scope."}
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

