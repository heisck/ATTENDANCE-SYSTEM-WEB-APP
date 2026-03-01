"use client";

import { useMemo, useState } from "react";
import { Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { OverviewMetrics } from "@/components/dashboard/overview-metrics";
import type { FeatureFlags } from "@/lib/organization-settings";

type StudentRow = {
  name: string;
  indexNumber: string;
  institutionEmail: string;
  registeredCourses: number;
  attendanceRecords: number;
};

type CourseRepRow = {
  rep: string;
  scope: string;
  status: string;
  assignedAt: string;
};

export function ClassDetailPanel({
  classGroupId,
  classGroupName,
  students,
  courseReps,
  initialFeatureFlags,
}: {
  classGroupId: string;
  classGroupName: string;
  students: StudentRow[];
  courseReps: CourseRepRow[];
  initialFeatureFlags: FeatureFlags;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>(initialFeatureFlags);
  const [savingGovernance, setSavingGovernance] = useState(false);

  const filteredStudents = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return students;

    return students.filter((student) => {
      return (
        student.name.toLowerCase().includes(normalized) ||
        student.institutionEmail.toLowerCase().includes(normalized) ||
        student.indexNumber.toLowerCase().includes(normalized)
      );
    });
  }, [searchQuery, students]);

  async function saveGovernance() {
    setSavingGovernance(true);
    try {
      const response = await fetch(`/api/admin/classes/${classGroupId}/governance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureFlags }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to save class governance");
      }
      toast.success("Class governance updated");
    } catch (error: any) {
      toast.error(error?.message || "Unable to save class governance");
    } finally {
      setSavingGovernance(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{classGroupName}</h1>
          <p className="text-sm text-muted-foreground">
            Search students and manage Student Hub governance for this class group only.
          </p>
        </div>
        <label className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search student name, email, or index number..."
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
          />
        </label>
      </section>

      <section className="surface space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Student Hub Governance (Class Level)</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              These switches apply only to {classGroupName}. Organization defaults remain unchanged.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveGovernance()}
            disabled={savingGovernance}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {savingGovernance ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>

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

      <OverviewMetrics
        title="Class Snapshot"
        compact
        showTopBorder={false}
        items={[
          { key: "students", label: "Students", value: students.length },
          { key: "courseReps", label: "Course Reps", value: courseReps.filter((item) => item.status === "Enabled").length },
          {
            key: "enrollments",
            label: "Total Course Registrations",
            value: students.reduce((sum, student) => sum + student.registeredCourses, 0),
          },
          {
            key: "attendances",
            label: "Attendance Records",
            value: students.reduce((sum, student) => sum + student.attendanceRecords, 0),
          },
        ]}
      />

      <AttendanceTable
        columns={[
          { key: "name", label: "Student" },
          { key: "indexNumber", label: "Index Number" },
          { key: "institutionEmail", label: "Institution Email" },
          { key: "registeredCourses", label: "Registered Courses" },
          { key: "attendanceRecords", label: "Attendance Records" },
        ]}
        data={filteredStudents.map((student) => ({
          name: student.name,
          indexNumber: student.indexNumber,
          institutionEmail: student.institutionEmail,
          registeredCourses: student.registeredCourses,
          attendanceRecords: student.attendanceRecords,
        }))}
        emptyMessage="No matching students found in this class group."
      />

      <AttendanceTable
        columns={[
          { key: "rep", label: "Course Rep" },
          { key: "scope", label: "Scope" },
          { key: "status", label: "Status" },
          { key: "assignedAt", label: "Assigned" },
        ]}
        data={courseReps.map((scope) => ({
          rep: scope.rep,
          scope: scope.scope,
          status: scope.status,
          assignedAt: scope.assignedAt,
        }))}
        emptyMessage="No course reps assigned for this class group."
      />
    </div>
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
