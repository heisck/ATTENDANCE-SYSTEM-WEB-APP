"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardActionButton, getDashboardButtonClassName } from "@/components/dashboard/dashboard-controls";
import { PageHeader } from "@/components/dashboard/page-header";
import { formatSessionKind } from "@/lib/session-flow";

type HistoricalPhase = "PHASE_ONE" | "PHASE_TWO" | "CLOSED";

export type LecturerSessionHistoryItem = {
  id: string;
  course: {
    code: string;
    name: string;
  };
  sessionFlow: string;
  status: "ACTIVE" | "CLOSED";
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  historicalPhase: HistoricalPhase;
  startedAt: string;
  endsAt: string;
  closedAt: string | null;
  markedCount: number;
};

function mapSessionRow(row: any): LecturerSessionHistoryItem {
  return {
    id: row.id,
    course: {
      code: row.course?.code ?? "",
      name: row.course?.name ?? "",
    },
    sessionFlow: typeof row.sessionFlow === "string" ? row.sessionFlow : "NEW_SESSION",
    status: row.status === "ACTIVE" ? "ACTIVE" : "CLOSED",
    phase:
      row.phase === "PHASE_ONE" || row.phase === "PHASE_TWO" || row.phase === "CLOSED"
        ? row.phase
        : "CLOSED",
    historicalPhase:
      row.historicalPhase === "PHASE_ONE" ||
      row.historicalPhase === "PHASE_TWO" ||
      row.historicalPhase === "CLOSED"
        ? row.historicalPhase
        : "CLOSED",
    startedAt: row.startedAt,
    endsAt: row.endsAt,
    closedAt: typeof row.closedAt === "string" ? row.closedAt : null,
    markedCount:
      typeof row?._count?.records === "number"
        ? row._count.records
        : typeof row.markedCount === "number"
          ? row.markedCount
          : 0,
  };
}

function formatSessionDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function historyKindLabel(session: LecturerSessionHistoryItem) {
  return formatSessionKind({
    sessionFlow: session.sessionFlow,
    phase: session.historicalPhase === "CLOSED" ? "CLOSED" : session.historicalPhase,
  });
}

export function LecturerSessionHistoryPanel({
  initialSessions,
}: Readonly<{
  initialSessions: LecturerSessionHistoryItem[];
}>) {
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [rowDeletingId, setRowDeletingId] = useState<string | null>(null);

  const selectedCount = selectedIds.length;
  const allSelected = sessions.length > 0 && selectedCount === sessions.length;

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const refreshSessions = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/attendance/sessions?status=CLOSED&take=100", {
        cache: "no-store",
      });
      const body = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(body?.error || "Unable to load session history.");
      }

      const nextSessions = Array.isArray(body) ? body.map(mapSessionRow) : [];
      setSessions(nextSessions);
      const nextIds = new Set(nextSessions.map((session) => session.id));
      setSelectedIds((current) => current.filter((sessionId) => nextIds.has(sessionId)));
    } catch (error: any) {
      toast.error(error?.message || "Unable to load session history.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((current) => (current.length === sessions.length ? [] : sessions.map((session) => session.id)));
  }, [sessions]);

  const toggleSelection = useCallback((sessionId: string) => {
    setSelectedIds((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
    );
  }, []);

  const removeSessionsFromState = useCallback((deletedIds: string[]) => {
    const deletedIdSet = new Set(deletedIds);
    setSessions((current) => current.filter((session) => !deletedIdSet.has(session.id)));
    setSelectedIds((current) => current.filter((sessionId) => !deletedIdSet.has(sessionId)));
  }, []);

  const handleDeleteOne = useCallback(
    async (session: LecturerSessionHistoryItem) => {
      const confirmDelete = confirm(
        `Delete ${session.course.code} from session history? This cannot be undone.`
      );
      if (!confirmDelete) {
        return;
      }

      setRowDeletingId(session.id);
      try {
        const response = await fetch(`/api/attendance/sessions/${session.id}`, {
          method: "DELETE",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body?.error || "Unable to delete session.");
        }

        removeSessionsFromState([session.id]);
        toast.success("Session deleted.");
      } catch (error: any) {
        toast.error(error?.message || "Unable to delete session.");
      } finally {
        setRowDeletingId(null);
      }
    },
    [removeSessionsFromState]
  );

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) {
      return;
    }

    const confirmDelete = confirm(
      `Delete ${selectedIds.length} session${selectedIds.length === 1 ? "" : "s"} from history? This cannot be undone.`
    );
    if (!confirmDelete) {
      return;
    }

    setBulkDeleting(true);
    try {
      const response = await fetch("/api/attendance/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error || "Unable to delete selected sessions.");
      }

      const deletedIds = Array.isArray(body?.deletedSessionIds)
        ? body.deletedSessionIds.filter((value: unknown): value is string => typeof value === "string")
        : selectedIds;
      removeSessionsFromState(deletedIds);
      toast.success(
        `${deletedIds.length} session${deletedIds.length === 1 ? "" : "s"} deleted.`
      );
    } catch (error: any) {
      toast.error(error?.message || "Unable to delete selected sessions.");
    } finally {
      setBulkDeleting(false);
    }
  }, [removeSessionsFromState, selectedIds]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lecturer"
        title="Session History"
        description="Review ended attendance sessions, reopen their details, or delete records you no longer need."
        action={
          <div className="flex flex-wrap gap-2">
            <DashboardActionButton
              type="button"
              onClick={() => void refreshSessions()}
              icon={RefreshCw}
              loading={refreshing}
            >
              Refresh
            </DashboardActionButton>
            <DashboardActionButton
              type="button"
              onClick={() => void handleDeleteSelected()}
              disabled={selectedCount === 0 || bulkDeleting}
              icon={Trash2}
              loading={bulkDeleting}
              variant="danger"
            >
              Delete Selected
            </DashboardActionButton>
          </div>
        }
      />

      <section className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
          <div>
            <p className="text-sm font-semibold">Closed Sessions</p>
            <p className="text-xs text-muted-foreground">
              {sessions.length} session{sessions.length === 1 ? "" : "s"} in history
              {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
            </p>
          </div>

          {sessions.length > 0 ? (
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
              />
              Select all
            </label>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px]">
            <thead>
              <tr className="border-b border-border/70 bg-muted/35">
                <th className="w-12 px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Course
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Session
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Started
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Ended
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Marked
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-sm text-muted-foreground">
                    No closed sessions yet.
                  </td>
                </tr>
              ) : (
                sessions.map((session) => {
                  const deleting = rowDeletingId === session.id;

                  return (
                    <tr
                      key={session.id}
                      className="border-b border-border/60 align-top transition-colors hover:bg-muted/20 last:border-0"
                    >
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIdSet.has(session.id)}
                          onChange={() => toggleSelection(session.id)}
                          disabled={bulkDeleting || deleting}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                          aria-label={`Select ${session.course.code}`}
                        />
                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{session.course.code}</p>
                          <p className="text-sm text-muted-foreground">{session.course.name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            {historyKindLabel(session)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {session.historicalPhase === "PHASE_ONE"
                              ? "Phase 1"
                              : session.historicalPhase === "PHASE_TWO"
                                ? "Phase 2"
                                : "Closed"}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-foreground/90">
                        {formatSessionDate(session.startedAt)}
                      </td>
                      <td className="px-4 py-4 text-sm text-foreground/90">
                        {formatSessionDate(session.closedAt ?? session.endsAt)}
                      </td>
                      <td className="px-4 py-4 text-sm text-foreground/90">
                        {session.markedCount}
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full border border-border/70 bg-muted/70 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {session.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/lecturer/session/${session.id}`}
                            className={getDashboardButtonClassName({
                              className: "h-9 px-3 text-xs",
                            })}
                          >
                            <Eye className="h-4 w-4" />
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={() => void handleDeleteOne(session)}
                            disabled={bulkDeleting || deleting}
                            className={getDashboardButtonClassName({
                              variant: "danger",
                              className: "h-9 px-3 text-xs",
                            })}
                          >
                            {deleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
