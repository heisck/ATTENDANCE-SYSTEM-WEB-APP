"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

type ClassGroupRow = {
  id: string;
  displayName: string;
  students: number;
  courseReps: number;
};

export function ClassGroupsTablePanel({ rows }: { rows: ClassGroupRow[] }) {
  const [query, setQuery] = useState("");

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => row.displayName.toLowerCase().includes(normalized));
  }, [query, rows]);

  return (
    <section className="space-y-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search class group..."
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </label>

      <AttendanceTable
        columns={[
          { key: "classGroup", label: "Class Group" },
          { key: "students", label: "Students" },
          { key: "courseReps", label: "Course Reps" },
          { key: "manage", label: "" },
        ]}
        data={filteredRows.map((group) => ({
          classGroup: (
            <Link href={`/admin/classes/${group.id}`} className="font-medium text-primary hover:underline">
              {group.displayName}
            </Link>
          ),
          students: group.students,
          courseReps: group.courseReps,
          manage: (
            <Link href={`/admin/classes/${group.id}`} className="text-primary text-sm font-medium hover:underline">
              Open Class
            </Link>
          ),
        }))}
        emptyMessage="No class groups found."
      />
    </section>
  );
}
