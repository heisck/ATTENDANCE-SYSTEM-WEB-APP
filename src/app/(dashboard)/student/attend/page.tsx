"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/qr-scanner";
import { QrDisplay } from "@/components/qr-display";
import { GpsCheck } from "@/components/gps-check";
import { WebAuthnPrompt } from "@/components/webauthn-prompt";
import { BleProximityCheck } from "@/components/ble-proximity-check";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Fingerprint,
  MapPin,
  QrCode,
  AlertTriangle,
  Clock,
  RefreshCcw,
  Share2,
} from "lucide-react";

type Step = "session" | "webauthn" | "gps" | "qr" | "submitting" | "result";
type QrPortStatus = "PENDING" | "APPROVED" | "REJECTED" | null;

interface ActiveSession {
  id: string;
  radiusMeters: number;
  course: { code: string; name: string };
  hasMarked?: boolean;
}

interface LayerResult {
  webauthn: boolean;
  gps: boolean;
  qr: boolean;
  ip?: boolean;
}

interface AttendanceResult {
  success: boolean;
  confidence: number;
  flagged: boolean;
  gpsDistance: number;
  layers: LayerResult;
  error?: string;
}

interface SessionSyncResponse {
  session: {
    id: string;
    status: "ACTIVE" | "CLOSED";
    phase: "INITIAL" | "REVERIFY" | "CLOSED";
    phaseEndsAt: string;
    currentSequenceId: string;
    nextSequenceId: string;
  };
  attendance: {
    id: string;
    initialMarkedAt: string;
    reverifyRequired: boolean;
    reverifyStatus:
      | "NOT_REQUIRED"
      | "PENDING"
      | "RETRY_PENDING"
      | "MISSED"
      | "PASSED"
      | "FAILED"
      | "MANUAL_PRESENT";
    reverifyDeadlineAt: string | null;
    reverifyAttemptCount: number;
    reverifyRetryCount: number;
    reverifyMarkedAt: string | null;
    reverifyManualOverride: boolean;
    flagged: boolean;
    canRequestRetry: boolean;
  } | null;
  qrPortStatus?: QrPortStatus;
}

const SESSION_REFRESH_MS = 5000;

export default function AttendPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("session");
  const [webauthnVerified, setWebauthnVerified] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [result, setResult] = useState<AttendanceResult | null>(null);
  const [hasDevice, setHasDevice] = useState<boolean | null>(null);

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<ActiveSession | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SessionSyncResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [requestingRetry, setRequestingRetry] = useState(false);
  const [requestingQrPort, setRequestingQrPort] = useState(false);
  const [qrPortStatusLocal, setQrPortStatusLocal] = useState<QrPortStatus>(null);

  const [reverifyPasskeyVerified, setReverifyPasskeyVerified] = useState(false);
  const [reverifySubmitting, setReverifySubmitting] = useState(false);
  const [reverifyError, setReverifyError] = useState<string | null>(null);
  const [reverifyCountdown, setReverifyCountdown] = useState<number | null>(null);

  const reverifyStatus = syncState?.attendance?.reverifyStatus;
  const isPendingReverify =
    reverifyStatus === "PENDING" || reverifyStatus === "RETRY_PENDING";
  const qrPortStatus = syncState?.qrPortStatus ?? qrPortStatusLocal ?? null;

  const mapSessions = (data: any[]): ActiveSession[] =>
    data.map((s: any) => ({
      id: s.id,
      radiusMeters: s.radiusMeters ?? 50,
      course: s.course ?? { code: s.courseCode ?? "", name: s.courseName ?? "" },
      hasMarked: s.hasMarked ?? false,
    }));

  useEffect(() => {
    async function checkDevice() {
      try {
        const statusRes = await fetch("/api/auth/student-status");
        if (statusRes.ok) {
          const status = await statusRes.json();
          if (status.requiresProfileCompletion || !status.personalEmailVerified) {
            router.push("/student/complete-profile");
            return;
          }
          if (!status.hasPasskey) {
            router.push("/setup-device");
            return;
          }
        }

        const res = await fetch("/api/webauthn/devices");
        if (!res.ok) {
          setHasDevice(false);
          return;
        }

        const data = await res.json();
        setHasDevice(Array.isArray(data.devices) && data.devices.length > 0);
      } catch {
        setHasDevice(false);
      }
    }

    checkDevice();
  }, [router]);

  useEffect(() => {
    if (hasDevice !== true) return;
    let cancelled = false;
    async function loadSessions() {
      setSessionsLoading(true);
      try {
        const res = await fetch("/api/attendance/sessions?status=ACTIVE");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load sessions");
        if (!cancelled) {
          setSessions(Array.isArray(data) ? mapSessions(data) : []);
        }
      } catch {
        if (!cancelled) setSessions([]);
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    }
    loadSessions();
    return () => {
      cancelled = true;
    };
  }, [hasDevice]);

  useEffect(() => {
    if (hasDevice !== true || step !== "session") return;

    let cancelled = false;
    const refreshSessions = async () => {
      try {
        const res = await fetch("/api/attendance/sessions?status=ACTIVE", {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) return;
        if (!cancelled && Array.isArray(data)) {
          setSessions(mapSessions(data));
        }
      } catch {
        // Keep current list on transient network errors.
      }
    };

    void refreshSessions();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshSessions();
      }
    }, SESSION_REFRESH_MS);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        void refreshSessions();
      }
    };

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [hasDevice, step]);

  useEffect(() => {
    if (!activeSessionId) return;

    let cancelled = false;
    const fetchSync = async () => {
      try {
        const res = await fetch(`/api/attendance/sessions/${activeSessionId}/me`);
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error || "Failed to sync session state");
        }
        if (!cancelled) {
          setSyncState(body);
          setQrPortStatusLocal(body.qrPortStatus ?? null);
          setSyncError(null);
        }
      } catch (error: any) {
        if (!cancelled) {
          setSyncError(error.message);
        }
      }
    };

    fetchSync();
    const timer = setInterval(fetchSync, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!isPendingReverify) {
      setReverifyPasskeyVerified(false);
      setReverifySubmitting(false);
      setReverifyCountdown(null);
    }
  }, [isPendingReverify]);

  useEffect(() => {
    if (!reverifyPasskeyVerified || !isPendingReverify) return;
    setReverifyCountdown(6);
    const t = setInterval(() => {
      setReverifyCountdown((c) => (c === null || c <= 1 ? null : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [reverifyPasskeyVerified, isPendingReverify]);

  useEffect(() => {
    if (syncError) toast.error(syncError);
  }, [syncError]);

  useEffect(() => {
    if (reverifyError) toast.error(reverifyError);
  }, [reverifyError]);

  useEffect(() => {
    if (step === "result" && result && !result.success && result.error) {
      toast.error(result.error);
    }
  }, [result, step]);

  function handleWebAuthnVerified() {
    setWebauthnVerified(true);
    setStep("gps");
  }

  function handleGpsReady(lat: number, lng: number, accuracy: number) {
    setGps({ lat, lng, accuracy });
    setStep("qr");
  }

  async function handleInitialQrScan(data: { sessionId: string; token: string; ts: number }) {
    if (!gps) return;
    if (selectedSession && data.sessionId !== selectedSession.id) {
      toast.error("This QR belongs to a different session.");
      setResult({
        success: false,
        confidence: 0,
        flagged: true,
        gpsDistance: 0,
        layers: { webauthn: false, gps: false, qr: false, ip: false },
        error: "This QR belongs to a different session. Please scan the QR for your selected course.",
      });
      setStep("result");
      return;
    }

    setStep("submitting");

    try {
      const res = await fetch("/api/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: data.sessionId,
          qrToken: data.token,
          qrTimestamp: data.ts,
          gpsLat: gps.lat,
          gpsLng: gps.lng,
          gpsAccuracy: gps.accuracy,
          webauthnVerified,
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        toast.error(body.error || "Attendance failed.");
        setResult({
          success: false,
          confidence: 0,
          flagged: true,
          gpsDistance: 0,
          layers: { webauthn: false, gps: false, qr: false, ip: false },
          error: body.error,
        });
      } else {
        setResult({
          success: true,
          confidence: body.record.confidence,
          flagged: body.record.flagged,
          gpsDistance: body.record.gpsDistance,
          layers: body.record.layers,
        });
        setActiveSessionId(data.sessionId);
      }
      setStep("result");
    } catch {
      toast.error("Network error. Please try again.");
      setResult({
        success: false,
        confidence: 0,
        flagged: true,
        gpsDistance: 0,
        layers: { webauthn: false, gps: false, qr: false, ip: false },
        error: "Network error. Please try again.",
      });
      setStep("result");
    }
  }

  async function handleRequestRetry() {
    if (!activeSessionId) return;

    setRequestingRetry(true);
    setReverifyError(null);
    try {
      const res = await fetch(
        `/api/attendance/sessions/${activeSessionId}/reverify/request`,
        { method: "POST" }
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Retry request failed");
      }
      setSyncState((current) =>
        current
          ? {
              ...current,
              attendance: current.attendance
                ? {
                    ...current.attendance,
                    reverifyStatus: body.record.reverifyStatus,
                    reverifyRetryCount: body.record.reverifyRetryCount,
                    reverifyAttemptCount: body.record.reverifyAttemptCount,
                    reverifyDeadlineAt: body.record.reverifyDeadlineAt,
                    canRequestRetry: false,
                  }
                : current.attendance,
            }
          : current
      );
    } catch (error: any) {
      setReverifyError(error.message);
    } finally {
      setRequestingRetry(false);
    }
  }

  async function handleRequestQrPort() {
    if (!activeSessionId) return;

    setRequestingQrPort(true);
    try {
      const res = await fetch("/api/attendance/qr-port/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to request QR port");
      }

      const nextStatus = (body.status as QrPortStatus) ?? "PENDING";
      setQrPortStatusLocal(nextStatus);
      setSyncState((current) =>
        current
          ? {
              ...current,
              qrPortStatus: nextStatus,
            }
          : current
      );
      toast.success(body.message || "QR port request sent.");
    } catch (error: any) {
      toast.error(error.message || "Failed to request QR port");
    } finally {
      setRequestingQrPort(false);
    }
  }

  async function handleReverifyQrScan(data: { sessionId: string; token: string; ts: number }) {
    if (!activeSessionId) return;
    if (data.sessionId !== activeSessionId) {
      setReverifyError("This QR belongs to a different session.");
      return;
    }
    if (!reverifyPasskeyVerified) {
      setReverifyError("Passkey verification is required before scanning.");
      return;
    }

    setReverifySubmitting(true);
    setReverifyError(null);
    try {
      const res = await fetch("/api/attendance/reverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          qrToken: data.token,
          qrTimestamp: data.ts,
          webauthnVerified: true,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Reverification failed");
      }

      setSyncState((current) =>
        current
          ? {
              ...current,
              attendance: current.attendance
                ? {
                    ...current.attendance,
                    reverifyStatus: "PASSED",
                    reverifyMarkedAt: body.record.reverifyMarkedAt,
                    flagged: false,
                    canRequestRetry: false,
                  }
                : current.attendance,
            }
          : current
      );
      setReverifyPasskeyVerified(false);
    } catch (error: any) {
      setReverifyError(error.message);
    } finally {
      setReverifySubmitting(false);
    }
  }

  const reverifyMessage = useMemo(() => {
    if (!syncState?.attendance) return null;

    const attendance = syncState.attendance;
    if (!attendance.reverifyRequired) {
      return {
        tone: "neutral",
        title: "Hold on for reverification",
        body: "You were not selected for reverification this time. Stay on this page until the session ends—you may still be selected. Do not close the window.",
      };
    }

    switch (attendance.reverifyStatus) {
      case "PENDING":
      case "RETRY_PENDING":
        return {
          tone: "amber",
          title: "Reverification required",
          body: attendance.reverifyDeadlineAt
            ? `Complete reverification before ${new Date(
                attendance.reverifyDeadlineAt
              ).toLocaleTimeString()}.`
            : "Complete reverification now.",
        };
      case "PASSED":
      case "MANUAL_PRESENT":
        return {
          tone: "green",
          title: "Reverification completed",
          body: "Your attendance is fully verified.",
        };
      case "MISSED":
        return {
          tone: "yellow",
          title: "Reverification missed",
          body: "Request another slot if retries are still available.",
        };
      case "FAILED":
        return {
          tone: "red",
          title: "Reverification attempts exhausted",
          body: "You have been flagged for lecturer review.",
        };
      default:
        return null;
    }
  }, [syncState]);

  function resetFlow() {
    setStep("session");
    setSelectedSession(null);
    setWebauthnVerified(false);
    setGps(null);
    setResult(null);
    setActiveSessionId(null);
    setSyncState(null);
    setSyncError(null);
    setRequestingRetry(false);
    setRequestingQrPort(false);
    setQrPortStatusLocal(null);
    setReverifyPasskeyVerified(false);
    setReverifySubmitting(false);
    setReverifyError(null);
  }

  return (
    <div className="w-full max-w-none space-y-6">

      <BleProximityCheck />

      {hasDevice === null && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking registered devices...</p>
        </div>
      )}

      {hasDevice === false && (
        <div className="surface-muted space-y-3 p-6">
          <p className="font-semibold">No registered device found</p>
          <p className="text-sm text-muted-foreground">
            You must register a passkey before you can verify and mark attendance.
          </p>
          <Link
            href="/setup-device"
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Register Device
          </Link>
        </div>
      )}

      {hasDevice && !result && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                ["session", "webauthn", "gps", "qr", "submitting"].includes(step)
                  ? step === "qr"
                    ? "bg-primary text-primary-foreground"
                    : ["session", "webauthn", "gps", "qr", "submitting"].indexOf(step) > 2
                      ? "border border-border/70 bg-muted text-foreground"
                      : "bg-muted text-muted-foreground"
                  : "border border-border/70 bg-muted text-foreground"
              }`}
            >
              Phase 1
              {["qr", "submitting"].includes(step) ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : null}
            </span>
          </div>

          {step === "session" && (
            <div className="surface space-y-3 p-4 sm:p-5">
              <p className="text-sm font-medium">Select an active session</p>
              <p className="text-xs text-muted-foreground">
                Only sessions for courses you are enrolled in are shown.
              </p>
              {sessionsLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading sessions...
                </div>
              ) : sessions.length === 0 ? (
                <div className="status-panel">
                  No active sessions for your courses right now. Ask your lecturer to start a session.
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelectedSession(s);
                        setStep("webauthn");
                      }}
                      className="w-full rounded-md border border-border px-4 py-3 text-left hover:bg-accent transition-colors"
                    >
                      <span className="font-medium">{s.course.code}</span>
                      <span className="text-muted-foreground"> — {s.course.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {step === "webauthn" && <WebAuthnPrompt onVerified={handleWebAuthnVerified} />}
          {step === "gps" && (
            <GpsCheck
              onLocationReady={handleGpsReady}
              maxAccuracyMeters={selectedSession?.radiusMeters ?? 50}
            />
          )}
          {step === "qr" && (
            <div
              className="flex min-h-[60dvh] flex-col justify-center py-4 md:min-h-0 md:py-0"
              ref={(el) => {
                if (el && step === "qr") el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              <QrScanner onScan={handleInitialQrScan} />
            </div>
          )}
          {step === "submitting" && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="font-medium">Verifying attendance...</p>
            </div>
          )}
        </>
      )}

      {hasDevice && step === "result" && result && (
        <div className="space-y-4">
          {result.success && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="status-chip">
                Phase 1 <CheckCircle2 className="h-3.5 w-3.5" />
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                  reverifyStatus === "PASSED" || reverifyStatus === "MANUAL_PRESENT"
                    ? "status-chip"
                    : isPendingReverify
                      ? "status-chip"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                Phase 2
                {(reverifyStatus === "PASSED" || reverifyStatus === "MANUAL_PRESENT") && (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
              </span>
            </div>
          )}
          {!result.success && (
            <div className="surface-muted p-4">
              <p className="text-base font-semibold">Attendance was not completed.</p>
              <p className="mt-1 text-sm text-muted-foreground">{result.error}</p>
              <button
                type="button"
                onClick={resetFlow}
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Try Again
              </button>
            </div>
          )}

          {result.success && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-sm font-medium">Initial Verification Layers</p>
              <div className="space-y-2">
                <LayerRow
                  icon={<Fingerprint className="h-4 w-4" />}
                  label="WebAuthn Biometric"
                  passed={result.layers.webauthn}
                  points={34}
                />
                <LayerRow
                  icon={<MapPin className="h-4 w-4" />}
                  label={`GPS Proximity (${Math.round(result.gpsDistance)}m)`}
                  passed={result.layers.gps}
                  points={33}
                />
                <LayerRow
                  icon={<QrCode className="h-4 w-4" />}
                  label="QR Token"
                  passed={result.layers.qr}
                  points={33}
                />
              </div>
            </div>
          )}

          {activeSessionId && (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Reverification Sync</p>
                {syncState?.session && (
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
                    <Clock className="mr-1 h-3 w-3" />
                    {syncState.session.phase} until{" "}
                    {new Date(syncState.session.phaseEndsAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {syncState?.session && (
                <div className="status-panel-subtle text-xs">
                  Scan sequence <span className="font-semibold">{syncState.session.currentSequenceId}</span> now.
                  Next: <span className="font-semibold">{syncState.session.nextSequenceId}</span>.
                </div>
              )}

              {!syncState?.attendance && (
                <p className="text-sm text-muted-foreground">
                  Waiting for attendance state sync...
                </p>
              )}

              {syncState?.attendance && reverifyMessage && (
                <div
                  className={`rounded-md border p-3 text-sm ${
                    reverifyMessage.tone === "neutral"
                      ? "border-border bg-muted/50 text-foreground"
                    : reverifyMessage.tone === "green"
                        ? "border-border/70 bg-muted/40 text-foreground"
                        : reverifyMessage.tone === "amber"
                          ? "border-border/70 bg-muted/40 text-foreground"
                          : reverifyMessage.tone === "yellow"
                            ? "border-border/70 bg-muted/40 text-foreground"
                            : "border-border/70 bg-muted/40 text-foreground"
                  }`}
                >
                  <p className="font-medium">{reverifyMessage.title}</p>
                  <p className="mt-1">{reverifyMessage.body}</p>
                  <p className="mt-1 text-xs">
                    Attempts: {syncState.attendance.reverifyAttemptCount} | Retries used:{" "}
                    {syncState.attendance.reverifyRetryCount}
                  </p>
                </div>
              )}

              {syncState?.attendance?.canRequestRetry && (
                <button
                  onClick={handleRequestRetry}
                  disabled={requestingRetry}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  {requestingRetry ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  Request Reverification Retry
                </button>
              )}

              {isPendingReverify && (
                <div className="surface-muted space-y-3 p-3">
                  <div className="flex items-start gap-2 text-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">
                        Reverification about to start. Verify your passkey again.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        After verification, you&apos;ll get a 6-second heads-up before the scan window.
                      </p>
                    </div>
                  </div>

                  {!reverifyPasskeyVerified ? (
                    <WebAuthnPrompt onVerified={() => setReverifyPasskeyVerified(true)} />
                  ) : reverifyCountdown !== null && reverifyCountdown > 0 ? (
                    <div className="status-panel-subtle p-4 text-center">
                      <p className="text-lg font-semibold">
                        Scan in {reverifyCountdown} second{reverifyCountdown !== 1 ? "s" : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Point your camera at the QR when the countdown ends.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-foreground">
                        Passkey verified. Scan the reverification QR now.
                      </p>
                      {reverifySubmitting ? (
                        <div className="status-panel-subtle flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Submitting reverification...
                        </div>
                      ) : (
                        <QrScanner onScan={handleReverifyQrScan} />
                      )}
                    </div>
                  )}
                </div>
              )}

              {(reverifyStatus === "PASSED" || reverifyStatus === "MANUAL_PRESENT") && (
                <div className="status-panel p-4 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10" />
                  <p className="mt-2 font-semibold">Fully done!</p>
                  <p className="text-sm text-muted-foreground">You can close this window.</p>
                </div>
              )}

              <div className="surface-muted space-y-3 p-3">
                <div className="flex items-start gap-2">
                  <Share2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">Share Live QR Stream</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      After lecturer approval, this device mirrors the live QR sequence for nearby classmates with camera issues.
                    </p>
                  </div>
                </div>

                {qrPortStatus === "APPROVED" ? (
                  <div className="space-y-3">
                    <div className="status-panel-subtle text-xs">
                      Approved. Keep this screen visible so friends can scan the same rotating QR sequence.
                    </div>
                    <div className="overflow-x-auto">
                      <QrDisplay sessionId={activeSessionId} mode="port" />
                    </div>
                  </div>
                ) : qrPortStatus === "PENDING" ? (
                  <div className="status-panel-subtle text-xs">
                    Request sent. Waiting for lecturer approval.
                  </div>
                ) : qrPortStatus === "REJECTED" ? (
                  <div className="status-panel-subtle text-xs">
                    Your request was declined for this session.
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleRequestQrPort}
                    disabled={requestingQrPort}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    {requestingQrPort ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4" />
                    )}
                    Request QR Port Access
                  </button>
                )}
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LayerRow({
  icon,
  label,
  passed,
  points,
}: {
  icon: React.ReactNode;
  label: string;
  passed: boolean;
  points: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={passed ? "text-foreground" : "text-muted-foreground"}>
          {icon}
        </span>
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-medium ${
            passed ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {passed ? `+${points}` : "+0"}
        </span>
        {passed ? (
          <CheckCircle2 className="h-4 w-4 text-foreground" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
