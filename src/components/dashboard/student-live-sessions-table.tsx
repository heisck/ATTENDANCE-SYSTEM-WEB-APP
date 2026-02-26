"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Loader2 } from "lucide-react";
import { AttendanceTable } from "@/components/dashboard/attendance-table";

type LiveSession = {
  id: string;
  phase: "INITIAL" | "REVERIFY" | "CLOSED";
  startedAt: string;
  course: {
    code: string;
    name: string;
  };
};

type LiveSessionsResponse = {
  sessions: LiveSession[];
  nextPollMs?: number;
};

const DEFAULT_ACTIVE_POLL_MS = 15_000;
const DEFAULT_IDLE_POLL_MS = 45_000;
const ERROR_POLL_MS = 60_000;

function withJitter(baseMs: number) {
  const delta = Math.round(baseMs * 0.15);
  return Math.max(5_000, baseMs + Math.round((Math.random() * 2 - 1) * delta));
}

export function StudentLiveSessionsTable({
  initialSessions,
}: {
  initialSessions: LiveSession[];
}) {
  const [sessions, setSessions] = useState<LiveSession[]>(initialSessions);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        void syncSessions();
      }, withJitter(delayMs));
    };

    const syncSessions = async (forced = false) => {
      if (cancelled) return;

      if (!forced && document.visibilityState !== "visible") {
        schedule(DEFAULT_IDLE_POLL_MS);
        return;
      }

      if (!navigator.onLine) {
        schedule(ERROR_POLL_MS);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSyncing(true);
      try {
        const res = await fetch("/api/student/live-sessions", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error("Unable to refresh live sessions.");
        }
        const data = (await res.json()) as LiveSessionsResponse;
        if (cancelled) return;

        const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
        setSessions(nextSessions);
        setSyncError(null);

        const nextPollMs =
          typeof data.nextPollMs === "number"
            ? data.nextPollMs
            : nextSessions.length > 0
              ? DEFAULT_ACTIVE_POLL_MS
              : DEFAULT_IDLE_POLL_MS;
        schedule(nextPollMs);
      } catch (error: any) {
        if (cancelled || error?.name === "AbortError") return;
        setSyncError(error?.message || "Unable to refresh live sessions.");
        schedule(ERROR_POLL_MS);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    };

    const onFocus = () => void syncSessions(true);
    const onOnline = () => void syncSessions(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void syncSessions(true);
      }
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    void syncSessions(true);

    return () => {
      cancelled = true;
      clearTimer();
      abortRef.current?.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex min-h-5 items-center justify-end">
        {syncing ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Updating...
          </span>
        ) : null}
      </div>
      <AttendanceTable
        columns={[
          { key: "course", label: "Course" },
          { key: "phase", label: "Phase" },
          { key: "started", label: "Started" },
          { key: "action", label: "" },
        ]}
        data={sessions.map((sessionItem) => ({
          course: `${sessionItem.course.code} - ${sessionItem.course.name}`,
          phase: (
            <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs font-medium">
              {sessionItem.phase}
            </span>
          ),
          started: new Date(sessionItem.startedAt).toLocaleTimeString(),
          action: (
            <Link
              href="/student/attend"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Eye className="h-3.5 w-3.5" />
              Open
            </Link>
          ),
        }))}
        emptyMessage="No live sessions right now."
      />
      {syncError ? <p className="text-xs text-muted-foreground">{syncError}</p> : null}
    </div>
  );
}
