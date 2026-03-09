"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { QrDisplay } from "@/components/qr-display";
import { QrPortApprovalPanel } from "@/components/qr-port-approval-panel";
import { Users, Clock, StopCircle, Loader2, AlertTriangle } from "lucide-react";

interface SessionData {
  id: string;
  status: string;
  phase: "INITIAL" | "REVERIFY" | "CLOSED";
  phaseEndsAt: string;
  startedAt: string;
  course: { code: string; name: string };
  records: {
    id: string;
    markedAt: string;
    confidence: number;
    flagged: boolean;
    student: { id: string; name: string; studentId: string | null };
  }[];
  _count: { records: number };
}

function getPhaseLabel(phase: SessionData["phase"]) {
  if (phase === "INITIAL") return "Phase 1";
  if (phase === "REVERIFY") return "Phase 2";
  return "Closed";
}

export default function SessionMonitorPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}`);
      if (res.ok) {
        const body = await res.json();
        setData(body);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchSession();
    const interval = setInterval(() => void fetchSession(), 5000);
    return () => clearInterval(interval);
  }, [fetchSession]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  const isActive = data.status === "ACTIVE";

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
            <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {data.status}
            </span>
            <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {getPhaseLabel(data.phase)}
            </span>
          </div>
        </div>

        {isActive && (
          <button
            onClick={handleClose}
            disabled={closing}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50 sm:w-auto"
          >
            {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <StopCircle className="h-4 w-4" />}
            End Session
          </button>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {isActive && (
          <div className="surface space-y-4 p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Live QR Code</h2>
            <QrDisplay sessionId={sessionId} />
          </div>
        )}

        <div className="surface space-y-4 p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Attendance ({data.records.length})</h2>
          <div className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
            {data.records.map((record) => (
              <div
                key={record.id}
                className="rounded-xl border border-border/70 bg-background/40 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{record.student.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {record.student.studentId || "No ID"} ·{" "}
                    {new Date(record.markedAt).toLocaleTimeString()}
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-sm font-mono">{record.confidence}%</span>
                  {record.flagged ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <AlertTriangle className="h-4 w-4" />
                      Flagged
                    </span>
                  ) : null}
                </div>
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
