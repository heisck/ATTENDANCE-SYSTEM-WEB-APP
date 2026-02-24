"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/qr-scanner";
import { GpsCheck } from "@/components/gps-check";
import { WebAuthnPrompt } from "@/components/webauthn-prompt";
import { BleProximityCheck } from "@/components/ble-proximity-check";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Fingerprint,
  MapPin,
  QrCode,
  Wifi,
  AlertTriangle,
  Clock,
  RefreshCcw,
  Share2,
} from "lucide-react";

type Step = "session" | "webauthn" | "gps" | "qr" | "submitting" | "result";

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
  qrPortStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
}

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

  const [reverifyPasskeyVerified, setReverifyPasskeyVerified] = useState(false);
  const [reverifySubmitting, setReverifySubmitting] = useState(false);
  const [reverifyError, setReverifyError] = useState<string | null>(null);
  const [reverifyCountdown, setReverifyCountdown] = useState<number | null>(null);

  const reverifyStatus = syncState?.attendance?.reverifyStatus;
  const isPendingReverify =
    reverifyStatus === "PENDING" || reverifyStatus === "RETRY_PENDING";

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
          setSessions(
            Array.isArray(data)
              ? data.map((s: any) => ({
                  id: s.id,
                  radiusMeters: s.radiusMeters ?? 50,
                  course: s.course ?? { code: s.courseCode ?? "", name: s.courseName ?? "" },
                  hasMarked: s.hasMarked ?? false,
                }))
              : []
          );
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
        tone: "green",
        title: "Initial attendance confirmed",
        body: "You were not selected for reverification. No further action is required.",
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
    setReverifyPasskeyVerified(false);
    setReverifySubmitting(false);
    setReverifyError(null);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mark Attendance</h1>
        <p className="text-muted-foreground">
          Initial attendance is followed by adaptive random reverification.
        </p>
      </div>

      <BleProximityCheck />

      {hasDevice === null && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking registered devices...</p>
        </div>
      )}

      {hasDevice === false && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 space-y-3">
          <p className="font-semibold text-yellow-800">No registered device found</p>
          <p className="text-sm text-yellow-700">
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
                      ? "bg-green-100 text-green-700"
                      : "bg-muted text-muted-foreground"
                  : "bg-green-100 text-green-700"
              }`}
            >
              Phase 1
              {["qr", "submitting"].includes(step) ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : null}
            </span>
          </div>

          {step === "session" && (
            <div className="rounded-lg border border-border p-4 space-y-3">
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
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
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
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-green-700">
                Phase 1 <CheckCircle2 className="h-3.5 w-3.5" />
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                  isPendingReverify ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-700"
                }`}
              >
                Phase 2
                {(reverifyStatus === "PASSED" || reverifyStatus === "MANUAL_PRESENT" || reverifyStatus === "NOT_REQUIRED") && (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
              </span>
            </div>
          )}
          <div
            className={`flex flex-col items-center gap-3 rounded-lg border p-8 ${
              result.success
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            {result.success ? (
              <>
                <CheckCircle2 className="h-16 w-16 text-green-600" />
                <p className="text-xl font-bold text-green-800">Initial Attendance Marked</p>
                <p className="text-sm text-green-700">
                  Confidence: {result.confidence}% {result.flagged ? "(Flagged for review)" : ""}
                </p>
              </>
            ) : (
              <>
                <XCircle className="h-16 w-16 text-red-600" />
                <p className="text-xl font-bold text-red-800">Attendance Failed</p>
                <p className="text-sm text-red-600">{result.error}</p>
              </>
            )}
          </div>

          {result.success && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-sm font-medium">Initial Verification Layers</p>
              <div className="space-y-2">
                <LayerRow
                  icon={<Fingerprint className="h-4 w-4" />}
                  label="WebAuthn Biometric"
                  passed={result.layers.webauthn}
                  points={40}
                />
                <LayerRow
                  icon={<MapPin className="h-4 w-4" />}
                  label={`GPS Proximity (${Math.round(result.gpsDistance)}m)`}
                  passed={result.layers.gps}
                  points={30}
                />
                <LayerRow
                  icon={<QrCode className="h-4 w-4" />}
                  label="QR Token"
                  passed={result.layers.qr}
                  points={20}
                />
                <LayerRow
                  icon={<Wifi className="h-4 w-4" />}
                  label="Campus Network"
                  passed={result.layers.ip}
                  points={10}
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
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                  Scan sequence <span className="font-semibold">{syncState.session.currentSequenceId}</span> now.
                  Next: <span className="font-semibold">{syncState.session.nextSequenceId}</span>.
                </div>
              )}

              {syncError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {syncError}
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
                    reverifyMessage.tone === "green"
                      ? "border-green-300 bg-green-50 text-green-800"
                      : reverifyMessage.tone === "amber"
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : reverifyMessage.tone === "yellow"
                          ? "border-yellow-300 bg-yellow-50 text-yellow-800"
                          : "border-red-300 bg-red-50 text-red-800"
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
                <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                  <div className="flex items-start gap-2 text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">
                        Reverification about to start. Verify your passkey again.
                      </p>
                      <p className="mt-1 text-xs text-amber-700">
                        After verification, you&apos;ll get a 6-second heads-up before the scan window.
                      </p>
                    </div>
                  </div>

                  {!reverifyPasskeyVerified ? (
                    <WebAuthnPrompt onVerified={() => setReverifyPasskeyVerified(true)} />
                  ) : reverifyCountdown !== null && reverifyCountdown > 0 ? (
                    <div className="rounded-md border border-amber-200 bg-white p-4 text-center">
                      <p className="text-lg font-semibold text-amber-800">
                        Scan in {reverifyCountdown} second{reverifyCountdown !== 1 ? "s" : ""}
                      </p>
                      <p className="mt-1 text-xs text-amber-600">
                        Point your camera at the QR when the countdown ends.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-amber-800">
                        Passkey verified. Scan the reverification QR now.
                      </p>
                      {reverifySubmitting ? (
                        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-white p-3 text-sm">
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

              {(reverifyStatus === "PASSED" || reverifyStatus === "MANUAL_PRESENT" || reverifyStatus === "NOT_REQUIRED") && (
                <div className="rounded-md border border-green-300 bg-green-50 p-4 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
                  <p className="mt-2 font-semibold text-green-800">Fully done!</p>
                  <p className="text-sm text-green-700">You can close this window.</p>
                </div>
              )}

              {reverifyError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {reverifyError}
                </div>
              )}
            </div>
          )}

          <button
            onClick={resetFlow}
            className="w-full rounded-md border border-border py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            Reset Attendance Flow
          </button>
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
        <span className={passed ? "text-green-600" : "text-muted-foreground"}>
          {icon}
        </span>
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-medium ${
            passed ? "text-green-600" : "text-muted-foreground"
          }`}
        >
          {passed ? `+${points}` : "+0"}
        </span>
        {passed ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
