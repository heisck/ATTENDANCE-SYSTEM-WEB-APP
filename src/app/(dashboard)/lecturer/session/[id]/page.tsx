"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { QrDisplay } from "@/components/qr-display";
import { QrPortApprovalPanel } from "@/components/qr-port-approval-panel";
import { Users, Clock, StopCircle, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface SessionData {
  id: string;
  status: string;
  phase: "INITIAL" | "REVERIFY" | "CLOSED";
  phaseEndsAt: string;
  reverifySelectionDone: boolean;
  reverifySelectedCount: number;
  startedAt: string;
  radiusMeters: number;
  course: { code: string; name: string };
  records: {
    id: string;
    markedAt: string;
    confidence: number;
    flagged: boolean;
    gpsDistance: number;
    reverifyRequired: boolean;
    reverifyStatus: string;
    reverifyAttemptCount: number;
    reverifyRetryCount: number;
    student: { id: string; name: string; studentId: string | null };
  }[];
  _count: { records: number };
}

export default function SessionMonitorPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [actionBusyFor, setActionBusyFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}`);
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch {
      // retry on next poll
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, 5000);
    return () => clearInterval(interval);
  }, [fetchSession]);

  useEffect(() => {
    if (actionError) toast.error(actionError);
  }, [actionError]);

  async function handleClose() {
    if (!confirm("Are you sure you want to close this session?")) return;

    setClosing(true);
    try {
      await fetch(`/api/attendance/sessions/${sessionId}`, { method: "PATCH" });
      router.push("/lecturer");
    } catch {
      setClosing(false);
    }
  }

  async function handleTargetedReverify(studentId: string) {
    setActionBusyFor(studentId);
    setActionError(null);
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}/reverify/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: [studentId] }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to open targeted reverification");
      }
      await fetchSession();
    } catch (error: any) {
      setActionError(error.message);
    } finally {
      setActionBusyFor(null);
    }
  }

  async function handleManualMark(studentId: string) {
    if (!confirm("Mark this student as physically present and clear reverification flag?")) {
      return;
    }

    setActionBusyFor(studentId);
    setActionError(null);
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}/reverify/manual-mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to mark student as present");
      }
      await fetchSession();
    } catch (error: any) {
      setActionError(error.message);
    } finally {
      setActionBusyFor(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  const isActive = data.status === "ACTIVE";
  const isReverify = data.phase === "REVERIFY";
  const pendingReverify = data.records.filter((r) => r.reverifyStatus === "PENDING" || r.reverifyStatus === "RETRY_PENDING").length;
  const passedReverify = data.records.filter((r) => r.reverifyStatus === "PASSED" || r.reverifyStatus === "MANUAL_PRESENT").length;
  const missedReverify = data.records.filter((r) => r.reverifyStatus === "MISSED").length;
  const failedReverify = data.records.filter((r) => r.reverifyStatus === "FAILED").length;

  return (
    <div className="space-y-6">
      <div className="page-header-block flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {data.course.code} - {data.course.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Started {new Date(data.startedAt).toLocaleTimeString()}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {data._count.records} students marked
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Phase ends {new Date(data.phaseEndsAt).toLocaleTimeString()}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isActive
                  ? "border border-border/70 bg-muted text-foreground"
                  : "border border-border/60 bg-muted/35 text-muted-foreground"
              }`}
            >
              {data.status}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                data.phase === "INITIAL"
                  ? "border border-border/70 bg-muted text-foreground"
                  : data.phase === "REVERIFY"
                    ? "border border-border/70 bg-muted text-foreground"
                    : "border border-border/60 bg-muted/35 text-muted-foreground"
              }`}
            >
              {data.phase}
            </span>
          </div>
        </div>

        {isActive && (
          <button
            onClick={handleClose}
            disabled={closing}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50 sm:w-auto"
          >
            {closing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <StopCircle className="h-4 w-4" />
            )}
            End Session
          </button>
        )}
      </div>

      {isReverify && (
        <div className="surface grid gap-3 p-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Selected</p>
            <p className="text-lg font-semibold">{data.reverifySelectedCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-lg font-semibold">{pendingReverify}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Passed</p>
            <p className="text-lg font-semibold">{passedReverify}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Missed / Failed</p>
            <p className="text-lg font-semibold">{missedReverify + failedReverify}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {isActive && (
          <div className="surface space-y-4 p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Live QR Code</h2>
            <QrDisplay sessionId={sessionId} />
          </div>
        )}

        <div className="surface space-y-4 p-4 sm:p-5">
          <h2 className="text-lg font-semibold">
            Attendance ({data.records.length})
          </h2>
          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
            {data.records.map((record) => (
              <div
                key={record.id}
                className="rounded-xl border border-border/70 bg-background/40 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{record.student.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {record.student.studentId || "No ID"} &middot;{" "}
                    {new Date(record.markedAt).toLocaleTimeString()}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Reverify: {record.reverifyStatus}
                    {record.reverifyAttemptCount > 0 ? ` (attempt ${record.reverifyAttemptCount})` : ""}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 sm:mt-2">
                  <span className="text-sm font-mono">{record.confidence}%</span>
                  <span className="text-xs text-muted-foreground">{Math.round(record.gpsDistance)}m</span>
                  {record.flagged && <AlertTriangle className="h-4 w-4 text-muted-foreground" />}
                </div>
                {(record.reverifyStatus === "MISSED" || record.reverifyStatus === "FAILED") && isReverify && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleTargetedReverify(record.student.id)}
                      disabled={actionBusyFor === record.student.id}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {actionBusyFor === record.student.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Clock className="h-3 w-3" />
                      )}
                      Allow Verify
                    </button>
                    <button
                      onClick={() => handleManualMark(record.student.id)}
                      disabled={actionBusyFor === record.student.id}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/80 disabled:opacity-50"
                    >
                      {actionBusyFor === record.student.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      Mark Present
                    </button>
                  </div>
                )}
              </div>
            ))}
            {data.records.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No students have marked attendance yet.
                <br />
                Display the QR code for students to scan.
              </p>
            )}
          </div>
        </div>
      </div>

      {isActive && (
        <div className="max-w-3xl">
          <QrPortApprovalPanel sessionId={sessionId} isLive />
        </div>
      )}
    </div>
  );
}
