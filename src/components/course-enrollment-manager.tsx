"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, UserPlus, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";

type Student = {
  id: string;
  name: string;
  email: string;
  studentId: string | null;
  indexNumber: string | null;
  cohort: {
    id: string;
    department: string;
    level: number;
    groupCode: string;
    displayName: string;
  } | null;
};
type Enrollment = { id: string; student: Student };

interface CourseEnrollmentManagerProps {
  courseId: string;
  courseCode: string;
  courseName: string;
  backHref: string;
}

function compareStudentsByName(a: Student, b: Student) {
  return (
    a.name.localeCompare(b.name) ||
    a.email.localeCompare(b.email) ||
    (a.studentId || "").localeCompare(b.studentId || "")
  );
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
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [cohortFilter, setCohortFilter] = useState("ALL");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const enrolledIds = useMemo(
    () => new Set(enrollments.map((enrollment) => enrollment.student.id)),
    [enrollments]
  );

  const cohortOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students) {
      if (!student.cohort) continue;
      map.set(
        student.cohort.id,
        student.cohort.displayName ||
          `${student.cohort.department} ${student.cohort.level} ${student.cohort.groupCode}`
      );
    }

    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [students]);

  const levelOptions = useMemo(() => {
    return Array.from(
      new Set(
        students
          .map((student) => student.cohort?.level)
          .filter((level): level is number => typeof level === "number")
      )
    ).sort((a, b) => a - b);
  }, [students]);

  const matchesFilters = useCallback(
    (student: Student) => {
      const matchesSearch =
        deferredSearch.length === 0 ||
        [
          student.name,
          student.email,
          student.studentId,
          student.indexNumber,
          student.cohort?.displayName,
          student.cohort?.department,
          student.cohort?.groupCode,
        ]
          .filter((value): value is string => typeof value === "string")
          .some((value) => value.toLowerCase().includes(deferredSearch));

      const matchesLevel =
        levelFilter === "ALL" ||
        String(student.cohort?.level ?? "") === levelFilter;

      const matchesCohort =
        cohortFilter === "ALL" || student.cohort?.id === cohortFilter;

      return matchesSearch && matchesLevel && matchesCohort;
    },
    [cohortFilter, deferredSearch, levelFilter]
  );

  const availableStudents = useMemo(
    () =>
      students
        .filter((student) => !enrolledIds.has(student.id))
        .filter(matchesFilters)
        .sort(compareStudentsByName),
    [students, enrolledIds, matchesFilters]
  );

  const filteredEnrollments = useMemo(
    () =>
      enrollments
        .filter((enrollment) => matchesFilters(enrollment.student))
        .sort((a, b) => compareStudentsByName(a.student, b.student)),
    [enrollments, matchesFilters]
  );

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

  async function handleAddAllFiltered() {
    const ids = availableStudents.map((student) => student.id);
    if (ids.length === 0) return;
    setSelectedIds(new Set(ids));
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
      <PageHeader
        eyebrow="Course"
        title={`${courseCode} - ${courseName}`}
        description="Manage which students are enrolled in this course."
        action={
          <Link
            href={backHref}
            prefetch
            className="inline-flex items-center rounded-md border border-border/70 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Back
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="surface p-4">
          <div className="mb-4 space-y-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, email, student number, index number, or cohort..."
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Level
                </span>
                <select
                  value={levelFilter}
                  onChange={(event) => setLevelFilter(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ALL">All levels</option>
                  {levelOptions.map((level) => (
                    <option key={level} value={String(level)}>
                      Level {level}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Program / Cohort
                </span>
                <select
                  value={cohortFilter}
                  onChange={(event) => setCohortFilter(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ALL">All cohorts</option>
                  {cohortOptions.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <Users className="h-5 w-5" />
            Enrolled Students ({filteredEnrollments.length})
          </h2>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {filteredEnrollments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No enrolled students match your current search or filters.
              </p>
            ) : (
              filteredEnrollments.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-md border border-border/70 bg-background/40 px-3 py-2">
                  <div>
                    <p className="font-medium">{e.student.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.student.email}
                      {e.student.studentId ? ` · ${e.student.studentId}` : ""}
                      {e.student.indexNumber ? ` · ${e.student.indexNumber}` : ""}
                    </p>
                    {e.student.cohort ? (
                      <p className="text-xs text-muted-foreground">
                        {e.student.cohort.displayName} · Level {e.student.cohort.level}
                      </p>
                    ) : null}
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

        <div className="surface p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <UserPlus className="h-5 w-5" />
              Add Students
            </h2>
            <button
              type="button"
              onClick={handleAddAllFiltered}
              disabled={adding || availableStudents.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Add All Filtered ({availableStudents.length})
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
            {availableStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No available students match your current filters.
              </p>
            ) : (
              availableStudents.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border/70 bg-background/40 px-3 py-2 hover:bg-muted/35"
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
                      {s.indexNumber ? ` · ${s.indexNumber}` : ""}
                    </p>
                    {s.cohort ? (
                      <p className="text-xs text-muted-foreground">
                        {s.cohort.displayName} · Level {s.cohort.level}
                      </p>
                    ) : null}
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
