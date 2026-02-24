"use client";

import { useEffect, useState } from "react";
import { Loader2, UserPlus, Trash2, Users } from "lucide-react";

type Student = { id: string; name: string; email: string; studentId: string | null; indexNumber: string | null };
type Enrollment = { id: string; student: Student };

interface CourseEnrollmentManagerProps {
  courseId: string;
  courseCode: string;
  courseName: string;
  backHref: string;
}

export function CourseEnrollmentManager({
  courseId,
  courseCode,
  courseName,
  backHref,
}: CourseEnrollmentManagerProps) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, [courseId]);

  async function loadData() {
    setLoading(true);
    try {
      const [enrollRes, studentsRes] = await Promise.all([
        fetch(`/api/enrollments?courseId=${encodeURIComponent(courseId)}`),
        fetch("/api/students"),
      ]);
      if (enrollRes.ok) setEnrollments(await enrollRes.json());
      if (studentsRes.ok) setStudents(await studentsRes.json());
    } finally {
      setLoading(false);
    }
  }

  const enrolledIds = new Set(enrollments.map((e) => e.student.id));
  const availableStudents = students.filter((s) => !enrolledIds.has(s.id));

  async function handleAdd() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setAdding(true);
    try {
      const res = await fetch("/api/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, studentIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add students");
      setSelectedIds(new Set());
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to add students");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(studentId: string) {
    if (!confirm("Remove this student from the course?")) return;
    try {
      const res = await fetch(
        `/api/enrollments?courseId=${encodeURIComponent(courseId)}&studentId=${encodeURIComponent(studentId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove");
      }
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to remove student");
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <a
            href={backHref}
            className="text-sm text-muted-foreground hover:text-foreground mb-2 inline-block"
          >
            ← Back
          </a>
          <h1 className="text-2xl font-bold">{courseCode} - {courseName}</h1>
          <p className="text-muted-foreground">
            Manage which students are enrolled in this course
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Users className="h-5 w-5" />
            Enrolled Students ({enrollments.length})
          </h2>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {enrollments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No students enrolled yet. Add students from the list on the right.
              </p>
            ) : (
              enrollments.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
                >
                  <div>
                    <p className="font-medium">{e.student.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.student.email}
                      {e.student.studentId ? ` · ${e.student.studentId}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(e.student.id)}
                    className="rounded p-2 text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <UserPlus className="h-5 w-5" />
            Add Students
          </h2>
          <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
            {availableStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                All students in your organization are already enrolled.
              </p>
            ) : (
              availableStudents.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    onChange={() => toggleSelect(s.id)}
                    className="rounded border-input"
                  />
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.email}
                      {s.studentId ? ` · ${s.studentId}` : ""}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || selectedIds.size === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Add {selectedIds.size > 0 ? `${selectedIds.size} ` : ""}Student{selectedIds.size !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
