"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

type CourseRow = {
  id: string;
  code: string;
  name: string;
  lecturer: string;
  students: number;
};

export function CoursesTablePanel({ rows }: { rows: CourseRow[] }) {
  const [query, setQuery] = useState("");

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => {
      return (
        row.code.toLowerCase().includes(normalized) ||
        row.name.toLowerCase().includes(normalized) ||
        row.lecturer.toLowerCase().includes(normalized)
      );
    });
  }, [query, rows]);

  return (
    <section className="space-y-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by course, code, or lecturer..."
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </label>

      <AttendanceTable
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "lecturer", label: "Lecturer" },
          { key: "students", label: "Students" },
          { key: "manage", label: "" },
        ]}
        data={filteredRows.map((row) => ({
          code: row.code,
          name: row.name,
          lecturer: row.lecturer,
          students: row.students,
          manage: (
            <Link href={`/admin/courses/${row.id}`} className="text-primary text-sm font-medium hover:underline">
              Manage enrollments
            </Link>
          ),
        }))}
        emptyMessage="No matching courses found."
      />
    </section>
  );
}
