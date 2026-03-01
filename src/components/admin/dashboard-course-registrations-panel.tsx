"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

type CourseRegistrationRow = {
  course: string;
  lecturer: string;
  students: number;
};

export function DashboardCourseRegistrationsPanel({
  rows,
}: {
  rows: CourseRegistrationRow[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;

    return rows.filter((row) => {
      return (
        row.course.toLowerCase().includes(normalized) ||
        row.lecturer.toLowerCase().includes(normalized)
      );
    });
  }, [query, rows]);

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/40"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        Courses Registered by Students
        <span className="text-xs text-muted-foreground">({rows.length})</span>
      </button>

      {open ? (
        <div className="space-y-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by course code, course title, or lecturer..."
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
            />
          </label>

          <AttendanceTable
            columns={[
              { key: "course", label: "Course" },
              { key: "lecturer", label: "Lecturer" },
              { key: "students", label: "Students Registered" },
            ]}
            data={filteredRows.map((row) => ({
              course: row.course,
              lecturer: row.lecturer,
              students: row.students,
            }))}
            emptyMessage="No matching courses found."
          />
        </div>
      ) : null}
    </section>
  );
}
