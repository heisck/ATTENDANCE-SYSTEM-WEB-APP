"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StudentHubShell } from "@/components/student-hub/student-hub-shell";

type SearchResult = {
  page: number;
  snippet: string;
};

export default function ExamPdfSearchPage() {
  const searchParams = useSearchParams();
  const examId = searchParams.get("examId") || "";
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchUnavailable, setSearchUnavailable] = useState<string | null>(null);
  const currentQuery = query.trim();
  const queryPreview = currentQuery
    ? `${currentQuery.slice(0, 18)}${currentQuery.length > 18 ? "..." : ""}`
    : "None";

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!examId) {
      toast.error("Missing examId in URL");
      return;
    }
    if (!query.trim()) {
      toast.error("Enter a keyword or student ID");
      return;
    }

    setLoading(true);
    setResults([]);
    setSearchUnavailable(null);
    try {
      const response = await fetch(
        `/api/student/hub/exams/${encodeURIComponent(examId)}/search?q=${encodeURIComponent(query.trim())}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed");

      if (data.searchAvailable === false) {
        setSearchUnavailable(data.message || "Search unavailable for this PDF");
        return;
      }

      setResults(Array.isArray(data.matches) ? data.matches : []);
    } catch (error: any) {
      toast.error(error?.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <StudentHubShell
        title="Exam PDF Search"
        description="Search text-based exam PDFs by keyword, name, or student ID from the refreshed Student Hub layout."
        activeRoute="search"
        metrics={[
          { label: "Exam Target", value: examId ? "Linked" : "Missing" },
          { label: "Current Query", value: queryPreview },
          { label: "Matches", value: String(results.length) },
          { label: "Search State", value: loading ? "Searching" : searchUnavailable ? "Unavailable" : "Ready" },
        ]}
      />

      <form onSubmit={runSearch} className="surface space-y-3 p-4">
        <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Search Query
        </label>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. KELVIN, 10458231"
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
        </div>
      </form>

      {searchUnavailable ? (
        <div className="surface p-4 text-sm text-muted-foreground">{searchUnavailable}</div>
      ) : null}

      <div className="surface p-4">
        {results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches yet.</p>
        ) : (
          <ul className="space-y-2">
            {results.map((result, index) => (
              <li key={`${result.page}-${index}`} className="rounded-md border border-border/70 bg-background/40 p-3">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Page {result.page}
                </p>
                <p className="mt-1 text-sm">{result.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
