"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { AttendanceTable } from "@/components/dashboard/attendance-table";
import { getDashboardButtonClassName } from "@/components/dashboard/dashboard-controls";

type CourseReportRow = {
  name: string;
  email: string;
  studentId: string | null;
  indexNumber: string | null;
  cohort: string | null;
  phaseOneDays: number;
  phaseTwoDays: number;
  fullyPresentDays: number;
  totalClassDays: number;
  percentage: number;
};

type CourseReportResponse = {
  course: {
    id: string;
    code: string;
    name: string;
  };
  totalClassDays: number;
  totalStudents: number;
  totalSessions: number;
  report: CourseReportRow[];
};

type SessionRow = {
  id: string;
  dateLabel: string;
  phaseLabel: string;
  attendanceLabel: string;
  status: string;
};

function matchesStudentQuery(row: CourseReportRow, query: string) {
  if (!query) {
    return true;
  }

  return [
    row.name,
    row.email,
    row.studentId,
    row.indexNumber,
    row.cohort,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(query));
}

export function LecturerCourseReportCard({
  courseId,
  courseCode,
  courseName,
  enrollmentCount,
  sessionCount,
  sessions,
}: {
  courseId: string;
  courseCode: string;
  courseName: string;
  enrollmentCount: number;
  sessionCount: number;
  sessions: SessionRow[];
}) {
  const [report, setReport] = useState<CourseReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/reports?courseId=${encodeURIComponent(courseId)}`,
          { cache: "no-store" }
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Unable to load course report");
        }

        if (!cancelled) {
          setReport(payload);
        }
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load course report"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadReport();

    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const filteredRows = useMemo(() => {
    const rows = report?.report ?? [];
    return rows.filter((row) => matchesStudentQuery(row, deferredQuery));
  }, [deferredQuery, report]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/40 p-3 sm:p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold leading-tight sm:text-lg">
              {courseCode} - {courseName}
            </h2>
            <p className="text-sm text-muted-foreground">
              {enrollmentCount} enrolled · {sessionCount} sessions
            </p>
            <p className="max-w-2xl text-xs text-muted-foreground">
              Full attendance counts only when a student completes both Phase 1 and Phase 2 on the same class day.
            </p>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto lg:min-w-[420px] lg:grid-cols-1 xl:grid-cols-3">
            <a
              href={`/api/reports/export?courseId=${courseId}&format=csv`}
              className={getDashboardButtonClassName({ className: "h-10 w-full text-xs" })}
            >
              Course CSV
            </a>
            <a
              href={`/api/reports/export?courseId=${courseId}&format=xlsx`}
              className={getDashboardButtonClassName({ className: "h-10 w-full text-xs" })}
            >
              Course Excel
            </a>
            <a
              href={`/api/reports/export?courseId=${courseId}&format=pdf`}
              className={getDashboardButtonClassName({ className: "h-10 w-full text-xs" })}
            >
              Course PDF
            </a>
          </div>
        </div>

        <label className="relative block w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search students by name, email, student number, index number, or course..."
            className="h-11 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading course report...
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <AttendanceTable
            columns={[
              { key: "name", label: "Student" },
              { key: "email", label: "Email" },
              { key: "studentId", label: "Student Number" },
              { key: "indexNumber", label: "Index Number" },
              { key: "cohort", label: "Course / Level" },
              { key: "phaseOneDays", label: "Phase 1" },
              { key: "phaseTwoDays", label: "Phase 2" },
              { key: "fullyPresentDays", label: "Full Days" },
              { key: "percentage", label: "Attendance" },
            ]}
            data={filteredRows.map((row) => ({
              name: row.name,
              email: row.email,
              studentId: row.studentId || "-",
              indexNumber: row.indexNumber || "-",
              cohort: row.cohort || "-",
              phaseOneDays: row.phaseOneDays,
              phaseTwoDays: row.phaseTwoDays,
              fullyPresentDays: `${row.fullyPresentDays} / ${row.totalClassDays}`,
              percentage: `${row.percentage}%`,
            }))}
            emptyMessage="No matching students found for this course."
          />
        )}
      </div>

      <AttendanceTable
        columns={[
          { key: "date", label: "Session Date" },
          { key: "phase", label: "Phase" },
          { key: "attendance", label: "Students Marked" },
          { key: "status", label: "Status" },
          { key: "export", label: "Export" },
        ]}
          data={sessions.map((session) => ({
            date: session.dateLabel,
            phase: session.phaseLabel,
            attendance: session.attendanceLabel,
            status: session.status,
            export: (
            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-2">
              <a
                href={`/api/reports/export?sessionId=${session.id}&format=csv`}
                className="text-xs font-medium text-primary hover:underline"
              >
                CSV
              </a>
              <a
                href={`/api/reports/export?sessionId=${session.id}&format=xlsx`}
                className="text-xs font-medium text-primary hover:underline"
              >
                Excel
              </a>
              <a
                href={`/api/reports/export?sessionId=${session.id}&format=pdf`}
                className="text-xs font-medium text-primary hover:underline"
              >
                PDF
              </a>
            </div>
          ),
        }))}
        emptyMessage="No sessions recorded yet."
      />
    </div>
  );
}
