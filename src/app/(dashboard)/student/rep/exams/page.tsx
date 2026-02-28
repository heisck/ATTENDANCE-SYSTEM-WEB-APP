"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
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

type ExamRow = {
  id: string;
  title: string;
  examDate: string;
  venue: string | null;
  allowAnyHall: boolean;
  cohortId: string | null;
  courseId: string | null;
  cohort?: { displayName: string } | null;
  course?: { code: string; name: string } | null;
  attachments: Array<{ id: string; fileName: string }>;
  updates: Array<{ id: string; message: string; effectiveAt: string }>;
};

export default function CourseRepExamsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [form, setForm] = useState({
    cohortId: "",
    courseId: "",
    title: "",
    examDate: "",
    endAt: "",
    venue: "",
    allowAnyHall: false,
    instructions: "",
  });
  const [updateMessage, setUpdateMessage] = useState<Record<string, string>>({});
  const [updateType, setUpdateType] = useState<Record<string, string>>({});
  const [updateEffectiveAt, setUpdateEffectiveAt] = useState<Record<string, string>>({});
  const [uploadingExamId, setUploadingExamId] = useState<string | null>(null);

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
        Boolean(flags.studentHubCore) && Boolean(flags.courseRepTools) && Boolean(flags.examHub);
      setEnabled(toolsEnabled);

      const scopeData = await scopeRes.json();
      if (!scopeRes.ok) throw new Error(scopeData.error || "Unable to load rep scopes");
      const nextScopes: Scope[] = scopeData.scopes || [];
      setScopes(nextScopes);

      if (toolsEnabled) {
        const examsRes = await fetch("/api/course-rep/exams", { cache: "no-store" });
        const examsData = await examsRes.json();
        if (!examsRes.ok) throw new Error(examsData.error || "Unable to load exams");
        setExams(examsData.exams || []);
      } else {
        setExams([]);
      }

      const firstCohort = nextScopes.find((scope) => scope.cohortId)?.cohortId || "";
      const firstCourse = nextScopes.find((scope) => scope.courseId)?.courseId || "";
      setForm((prev) => ({
        ...prev,
        cohortId: prev.cohortId || firstCohort,
        courseId: prev.courseId || firstCourse,
      }));
    } catch (error: any) {
      toast.error(error?.message || "Failed to load exams tools");
    } finally {
      setLoading(false);
    }
  }

  async function createExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        cohortId: form.cohortId || undefined,
        courseId: form.courseId || undefined,
        title: form.title,
        examDate: new Date(form.examDate).toISOString(),
        endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
        venue: form.venue || undefined,
        allowAnyHall: form.allowAnyHall,
        instructions: form.instructions || undefined,
      };
      const response = await fetch("/api/course-rep/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create exam");
      toast.success("Exam entry created");
      setForm((prev) => ({
        ...prev,
        title: "",
        examDate: "",
        endAt: "",
        venue: "",
        instructions: "",
        allowAnyHall: false,
      }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create exam");
    } finally {
      setSaving(false);
    }
  }

  async function deleteExam(id: string) {
    try {
      const response = await fetch(`/api/course-rep/exams/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete exam");
      toast.success("Exam entry deleted");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete exam");
    }
  }

  async function postExamUpdate(examId: string) {
    const message = (updateMessage[examId] || "").trim();
    if (!message) {
      toast.error("Enter update message");
      return;
    }
    const effectiveAt = updateEffectiveAt[examId];
    if (!effectiveAt) {
      toast.error("Set effective datetime");
      return;
    }

    try {
      const response = await fetch(`/api/course-rep/exams/${examId}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updateType: updateType[examId] || "NOTICE",
          message,
          effectiveAt: new Date(effectiveAt).toISOString(),
          payload: {},
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to post exam update");
      toast.success("Exam update posted");
      setUpdateMessage((prev) => ({ ...prev, [examId]: "" }));
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "Failed to post exam update");
    }
  }

  async function uploadPdf(examId: string, file: File | null) {
    if (!file) return;
    setUploadingExamId(examId);
    try {
      const contractRes = await fetch(`/api/course-rep/exams/${examId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mime: file.type || "application/pdf",
          bytes: file.size,
          resourceType: "raw",
        }),
      });
      const contractData = await contractRes.json();
      if (!contractRes.ok) throw new Error(contractData.error || "Failed to initialize upload");

      const uploadPayload = contractData.upload;
      const formData = new FormData();
      formData.set("file", file);
      formData.set("api_key", uploadPayload.apiKey);
      formData.set("timestamp", `${uploadPayload.timestamp}`);
      formData.set("signature", uploadPayload.signature);
      formData.set("folder", uploadPayload.folder);
      formData.set("public_id", uploadPayload.publicId);

      const cloudResponse = await fetch(uploadPayload.uploadUrl, {
        method: "POST",
        body: formData,
      });
      const cloudData = await cloudResponse.json();
      if (!cloudResponse.ok) {
        throw new Error(cloudData?.error?.message || "Cloudinary upload failed");
      }

      const finalizeRes = await fetch(`/api/course-rep/exams/${examId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          publicId: cloudData.public_id,
          resourceType: "raw",
          url: cloudData.secure_url,
          fileName: file.name,
          bytes: file.size,
          mime: file.type || "application/pdf",
        }),
      });
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error || "Failed to finalize attachment");

      toast.success("PDF attached to exam");
      await loadData();
    } catch (error: any) {
      toast.error(error?.message || "PDF upload failed");
    } finally {
      setUploadingExamId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Course Rep Tools"
        title="Manage Exams"
        description="Publish exam timetable, updates, and searchable PDF attachments."
      />

      {!enabled ? (
        <div className="surface p-4 text-sm text-muted-foreground">
          Exam tools are disabled for this organization.
        </div>
      ) : null}

      <form onSubmit={createExam} className="surface grid gap-4 p-4 sm:grid-cols-2">
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
          required
          onChange={(value) => setForm((prev) => ({ ...prev, title: value }))}
        />
        <FieldInput
          label="Exam Date"
          type="datetime-local"
          value={form.examDate}
          required
          onChange={(value) => setForm((prev) => ({ ...prev, examDate: value }))}
        />
        <FieldInput
          label="End At (optional)"
          type="datetime-local"
          value={form.endAt}
          onChange={(value) => setForm((prev) => ({ ...prev, endAt: value }))}
        />
        <FieldInput
          label="Venue"
          value={form.venue}
          onChange={(value) => setForm((prev) => ({ ...prev, venue: value }))}
        />
        <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.allowAnyHall}
            onChange={(event) => setForm((prev) => ({ ...prev, allowAnyHall: event.target.checked }))}
          />
          Allow any hall
        </label>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Instructions
          </label>
          <textarea
            value={form.instructions}
            onChange={(event) => setForm((prev) => ({ ...prev, instructions: event.target.value }))}
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
            Add Exam Entry
          </button>
        </div>
      </form>

      <AttendanceTable
        columns={[
          { key: "course", label: "Course" },
          { key: "title", label: "Title" },
          { key: "examDate", label: "Exam Date" },
          { key: "attachments", label: "PDFs" },
          { key: "updates", label: "Latest Update" },
          { key: "actions", label: "Actions" },
        ]}
        data={exams.map((exam) => ({
          course: exam.course ? `${exam.course.code} - ${exam.course.name}` : exam.cohort?.displayName || "-",
          title: exam.title,
          examDate: new Date(exam.examDate).toLocaleString(),
          attachments: (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{exam.attachments.length} attached</p>
              <label className="inline-flex cursor-pointer items-center gap-1 text-xs underline underline-offset-2">
                <Upload className="h-3.5 w-3.5" />
                {uploadingExamId === exam.id ? "Uploading..." : "Upload PDF"}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    void uploadPdf(exam.id, file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          ),
          updates: (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{exam.updates[0]?.message || "No updates yet"}</p>
              <div className="flex flex-wrap items-center gap-1">
                <select
                  value={updateType[exam.id] || "NOTICE"}
                  onChange={(event) =>
                    setUpdateType((prev) => ({ ...prev, [exam.id]: event.target.value }))
                  }
                  className="h-7 rounded-md border border-input bg-background px-2 text-[11px]"
                >
                  <option value="NOTICE">NOTICE</option>
                  <option value="VENUE_CHANGE">VENUE_CHANGE</option>
                  <option value="POSTPONED">POSTPONED</option>
                </select>
                <input
                  value={updateMessage[exam.id] || ""}
                  onChange={(event) =>
                    setUpdateMessage((prev) => ({ ...prev, [exam.id]: event.target.value }))
                  }
                  placeholder="Update message"
                  className="h-7 min-w-40 rounded-md border border-input bg-background px-2 text-[11px]"
                />
                <input
                  type="datetime-local"
                  value={updateEffectiveAt[exam.id] || ""}
                  onChange={(event) =>
                    setUpdateEffectiveAt((prev) => ({ ...prev, [exam.id]: event.target.value }))
                  }
                  className="h-7 rounded-md border border-input bg-background px-2 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => void postExamUpdate(exam.id)}
                  className="h-7 rounded-md border border-border px-2 text-[11px]"
                >
                  Post
                </button>
              </div>
            </div>
          ),
          actions: (
            <button
              type="button"
              onClick={() => void deleteExam(exam.id)}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          ),
        }))}
        emptyMessage={loading ? "Loading..." : "No exams in your scope."}
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

