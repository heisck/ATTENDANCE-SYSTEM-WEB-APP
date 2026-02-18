"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { QrDisplay } from "@/components/qr-display";
import { Users, Clock, StopCircle, Loader2, AlertTriangle } from "lucide-react";

interface SessionData {
  id: string;
  status: string;
  startedAt: string;
  radiusMeters: number;
  course: { code: string; name: string };
  records: {
    id: string;
    markedAt: string;
    confidence: number;
    flagged: boolean;
    gpsDistance: number;
    student: { name: string; studentId: string | null };
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
      <div className="text-center py-12">
        <p className="text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  const isActive = data.status === "ACTIVE";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {data.course.code} - {data.course.name}
          </h1>
          <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Started {new Date(data.startedAt).toLocaleTimeString()}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {data._count.records} students marked
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isActive
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {data.status}
            </span>
          </div>
        </div>

        {isActive && (
          <button
            onClick={handleClose}
            disabled={closing}
            className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50 transition-colors"
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

      <div className="grid gap-6 lg:grid-cols-2">
        {isActive && (
          <div className="flex flex-col items-center">
            <h2 className="mb-4 text-lg font-semibold">Live QR Code</h2>
            <QrDisplay sessionId={sessionId} />
          </div>
        )}

        <div>
          <h2 className="mb-4 text-lg font-semibold">
            Attendance ({data.records.length})
          </h2>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {data.records.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
              >
                <div>
                  <p className="text-sm font-medium">{record.student.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {record.student.studentId || "No ID"} &middot;{" "}
                    {new Date(record.markedAt).toLocaleTimeString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono">
                    {record.confidence}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(record.gpsDistance)}m
                  </span>
                  {record.flagged && (
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  )}
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
    </div>
  );
}
