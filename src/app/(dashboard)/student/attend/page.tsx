"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { QrScanner, type QrScanPayload, type QrScanResult } from "@/components/qr-scanner";
import { QrDisplay } from "@/components/qr-display";
import { WebAuthnPrompt } from "@/components/webauthn-prompt";
import { ATTENDANCE_BLE } from "@/lib/ble-spec";
import {
  Bluetooth,
  CheckCircle2,
  Fingerprint,
  Loader2,
  QrCode,
  Radio,
  RefreshCw,
  Share2,
  XCircle,
} from "lucide-react";

type Step = "webauthn" | "session" | "qr" | "result";
type QrPortStatus = "PENDING" | "APPROVED" | "REJECTED" | null;
type ScanMode = "QR" | "BLE";

interface ActiveSession {
  id: string;
  phase: "INITIAL" | "REVERIFY" | "CLOSED";
  radiusMeters: number;
  course: { code: string; name: string };
  hasMarked?: boolean;
}

interface LayerResult {
  webauthn: boolean;
  gps: boolean;
  qr: boolean;
  ble?: boolean;
  ip?: boolean;
}

interface AttendanceResult {
  success: boolean;
  confidence: number;
  flagged: boolean;
  gpsDistance: number;
  layers: LayerResult;
  alreadyMarked?: boolean;
  error?: string;
}

interface SessionSyncResponse {
  serverNow?: string;
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
    markedAt: string;
    flagged: boolean;
    confidence: number;
  } | null;
  qrPortStatus?: QrPortStatus;
}

interface SessionBleState {
  enabled: boolean;
  active: boolean;
  beaconName: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  serviceUuid: string;
  currentTokenCharacteristicUuid: string;
  sessionMetaCharacteristicUuid: string;
  manufacturerCompanyId: number;
  manufacturerDataHex: string | null;
  phase: "INITIAL" | "REVERIFY" | "CLOSED";
  phaseEndsAt: string;
}

interface BleScanTokenResult {
  token: string;
  sequence: number;
  phase: "INITIAL" | "REVERIFY";
  tokenTimestamp: number;
  beaconName?: string;
  signalStrength?: number;
}

const DEVICE_TOKEN_STORAGE_KEY = "attendanceiq:web-device-token:v1";

function getOrCreateBrowserDeviceToken() {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
  if (existing && existing.trim().length > 0) {
    return existing.trim();
  }

  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `web-${crypto.randomUUID()}`
      : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, generated);
  return generated;
}

function detectDeviceTypeFromUserAgent(userAgent: string): "iOS" | "Android" | "Web" {
  if (/android/i.test(userAgent)) return "Android";
  if (/(iphone|ipad|ipod)/i.test(userAgent)) return "iOS";
  return "Web";
}

function phaseLabel(phase: ActiveSession["phase"]) {
  if (phase === "INITIAL") return "Phase 1";
  if (phase === "REVERIFY") return "Phase 2";
  return "Closed";
}

export default function AttendPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>("webauthn");
  const [webauthnVerified, setWebauthnVerified] = useState(false);
  const [result, setResult] = useState<AttendanceResult | null>(null);
  const [hasDevice, setHasDevice] = useState<boolean | null>(null);

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<ActiveSession | null>(null);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SessionSyncResponse | null>(null);
  const [sessionBle, setSessionBle] = useState<SessionBleState | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>("QR");
  const [syncError, setSyncError] = useState<string | null>(null);

  const [requestingQrPort, setRequestingQrPort] = useState(false);
  const [qrPortStatusLocal, setQrPortStatusLocal] = useState<QrPortStatus>(null);
  const [initialVerifyTrigger, setInitialVerifyTrigger] = useState(0);
  const [initialScanTrigger, setInitialScanTrigger] = useState(0);

  const qrPortStatus = syncState?.qrPortStatus ?? qrPortStatusLocal ?? null;

  const mapSessions = (data: any[]): ActiveSession[] =>
    data.map((s: any) => ({
      id: s.id,
      phase: s.phase ?? "INITIAL",
      radiusMeters: s.radiusMeters ?? 0,
      course: s.course ?? { code: s.courseCode ?? "", name: s.courseName ?? "" },
      hasMarked: s.hasMarked ?? false,
    }));

  const fetchSessionSync = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/attendance/sessions/${sessionId}/me`, {
      cache: "no-store",
    });
    const body = await res.json();
    if (res.status === 410) {
      setSyncState(body);
      setQrPortStatusLocal(body.qrPortStatus ?? null);
      setSessionBle({
        enabled: false,
        active: false,
        beaconName: null,
        startedAt: null,
        expiresAt: null,
        serviceUuid: ATTENDANCE_BLE.SERVICE_UUID,
        currentTokenCharacteristicUuid: ATTENDANCE_BLE.CURRENT_TOKEN_CHAR_UUID,
        sessionMetaCharacteristicUuid: ATTENDANCE_BLE.SESSION_META_CHAR_UUID,
        manufacturerCompanyId: 0xffff,
        manufacturerDataHex: null,
        phase: "CLOSED",
        phaseEndsAt: body?.session?.phaseEndsAt ?? new Date().toISOString(),
      });
      return body as SessionSyncResponse;
    }
    if (!res.ok) throw new Error(body.error || "Failed to sync session");
    setSyncState(body);
    setQrPortStatusLocal(body.qrPortStatus ?? null);
    setSyncError(null);
    return body as SessionSyncResponse;
  }, []);

  const fetchSessionBle = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/attendance/sessions/${sessionId}/ble`, {
      cache: "no-store",
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || "Failed to sync BLE beacon state");
    }
    const payload = body as SessionBleState;
    setSessionBle(payload);
    return payload;
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/attendance/sessions?status=ACTIVE", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sessions");
      setSessions(Array.isArray(data) ? mapSessions(data) : []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

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

    void checkDevice();
  }, [router]);

  useEffect(() => {
    if (hasDevice !== true) return;
    void loadSessions();
  }, [hasDevice, loadSessions]);

  useEffect(() => {
    if (!activeSessionId) return;

    let cancelled = false;
    const sync = async () => {
      try {
        const body = await fetchSessionSync(activeSessionId);
        if (cancelled) return;

        if (body.session.status !== "ACTIVE") {
          setActiveSessionId(null);
          if (step === "qr") {
            setStep("session");
            setSelectedSession(null);
            void loadSessions();
            toast.info("This session has ended. Select an active session to continue.");
          }
          return;
        }

        try {
          await fetchSessionBle(activeSessionId);
        } catch {
          // Ignore transient BLE sync errors; fallback to QR remains available.
        }
        if (cancelled) return;
        if (body.attendance && result?.alreadyMarked) {
          setResult((current) =>
            current
              ? {
                  ...current,
                  confidence: body.attendance?.confidence ?? current.confidence,
                  flagged: body.attendance?.flagged ?? current.flagged,
                }
              : current
          );
        }
      } catch (error: any) {
        if (!cancelled) {
          setSyncError(error.message);
        }
      }
    };

    void sync();
    const timer = window.setInterval(() => void sync(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    activeSessionId,
    fetchSessionBle,
    fetchSessionSync,
    loadSessions,
    result?.alreadyMarked,
    step,
  ]);

  useEffect(() => {
    if (!syncError) return;
    toast.error(syncError);
  }, [syncError]);

  useEffect(() => {
    const mode = searchParams.get("mode");
    if (!mode) return;

    if (mode === "verify") {
      if (step === "webauthn") {
        setInitialVerifyTrigger((value) => value + 1);
      } else if (webauthnVerified) {
        toast.info("Passkey is already verified.");
      }
    } else if (mode === "scan") {
      if (step === "qr" && scanMode === "QR") {
        setInitialScanTrigger((value) => value + 1);
      } else if (step === "qr" && scanMode === "BLE") {
        toast.info("Use Search Beacon to scan lecturer Bluetooth.");
      } else {
        toast.info("Verify passkey and choose a session before scanning.");
      }
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("mode");
    const query = params.toString();
    router.replace(query ? `/student/attend?${query}` : "/student/attend");
  }, [router, scanMode, searchParams, step, webauthnVerified]);

  useEffect(() => {
    if (step === "qr" && scanMode === "QR") {
      setInitialScanTrigger((value) => value + 1);
    }
  }, [scanMode, step]);

  const handleWebAuthnVerified = useCallback(() => {
    setWebauthnVerified(true);
    setStep("session");
  }, []);

  const handleSelectSession = useCallback(
    async (session: ActiveSession) => {
      setSelectedSession(session);
      setActiveSessionId(session.id);
      setScanMode("QR");

      try {
        const bleState = await fetchSessionBle(session.id);
        if (bleState.enabled && bleState.active) {
          const isAndroidDevice =
            typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
          setScanMode(isAndroidDevice ? "BLE" : "QR");
        }
      } catch {
        setSessionBle(null);
      }

      if (session.hasMarked) {
        try {
          const body = await fetchSessionSync(session.id);
          setResult({
            success: true,
            confidence: body.attendance?.confidence ?? 100,
            flagged: body.attendance?.flagged ?? false,
            gpsDistance: 0,
            layers: { webauthn: true, gps: true, qr: true, ip: false },
            alreadyMarked: true,
          });
          setStep("result");
        } catch (error: any) {
          toast.error(error.message || "Failed to load session status");
        }
        return;
      }

      setResult(null);
      setStep("qr");
    },
    [fetchSessionBle, fetchSessionSync]
  );

  const handleInitialQrScan = useCallback(
    async (data: QrScanPayload): Promise<QrScanResult> => {
      if (!selectedSession) {
        toast.error("Select a session first.");
        return "stop";
      }

      if (data.sessionId !== selectedSession.id) {
        toast.error("This QR belongs to a different session.");
        return "retry";
      }

      try {
        const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
        const platform =
          typeof navigator !== "undefined" && typeof navigator.platform === "string"
            ? navigator.platform
            : "Web";
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const language =
          typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
        const deviceToken = getOrCreateBrowserDeviceToken();

        const res = await fetch("/api/attendance/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: data.sessionId,
            qrToken: data.token,
            qrTimestamp: data.ts,
            webauthnVerified,
            deviceToken,
            deviceName: `${platform} Browser`,
            deviceType: detectDeviceTypeFromUserAgent(userAgent),
            osVersion: userAgent,
            appVersion: "web",
            deviceFingerprint: `${platform}|${language}|${timezone}`,
          }),
        });

        const body = await res.json();
        if (!res.ok) {
          const message = body?.error || "Attendance failed.";
          toast.error(message);
          if (res.status === 400 || res.status === 429) {
            return "retry";
          }
          setResult({
            success: false,
            confidence: 0,
            flagged: true,
            gpsDistance: 0,
            layers: { webauthn: false, gps: false, qr: false, ip: false },
            error: message,
          });
          setStep("result");
          return "stop";
        }

        setResult({
          success: true,
          confidence: body.record.confidence,
          flagged: body.record.flagged,
          gpsDistance: body.record.gpsDistance,
          layers: body.record.layers,
        });
        setActiveSessionId(data.sessionId);
        setStep("result");
        toast.success("Attendance marked successfully.");
        void loadSessions();
        return "accepted";
      } catch {
        toast.error("Network error. Camera stays open so you can scan again.");
        return "retry";
      }
    },
    [loadSessions, selectedSession, webauthnVerified]
  );

  const submitBleAttendance = useCallback(
    async (payload: {
      sessionId: string;
      token: string;
      sequence: number;
      phase: "INITIAL" | "REVERIFY";
      tokenTimestamp: number;
      beaconName?: string;
      bleSignalStrength?: number;
    }) => {
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const platform =
        typeof navigator !== "undefined" && typeof navigator.platform === "string"
          ? navigator.platform
          : "Web";
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const language =
        typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
      const deviceToken = getOrCreateBrowserDeviceToken();

      const res = await fetch("/api/attendance/ble-mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          webauthnVerified,
          deviceToken,
          deviceName: `${platform} Browser`,
          deviceType: detectDeviceTypeFromUserAgent(userAgent),
          osVersion: userAgent,
          appVersion: "web",
          deviceFingerprint: `${platform}|${language}|${timezone}`,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || "BLE attendance failed.");
      }
      return body;
    },
    [webauthnVerified]
  );

  const handleBleAttendance = useCallback(
    async (params: BleScanTokenResult) => {
      if (!selectedSession) {
        toast.error("Select a session first.");
        return;
      }

      try {
        const body = await submitBleAttendance({
          sessionId: selectedSession.id,
          token: params.token,
          sequence: params.sequence,
          phase: params.phase,
          tokenTimestamp: params.tokenTimestamp,
          beaconName: params.beaconName,
          bleSignalStrength: params.signalStrength,
        });

        setResult({
          success: true,
          confidence: body.record.confidence,
          flagged: body.record.flagged,
          gpsDistance: body.record.gpsDistance,
          layers: body.record.layers,
        });
        setActiveSessionId(selectedSession.id);
        setStep("result");
        toast.success("Attendance marked successfully via Bluetooth beacon.");
        void loadSessions();
      } catch (error: any) {
        toast.error(error.message || "Failed to mark attendance via Bluetooth");
      }
    },
    [loadSessions, selectedSession, submitBleAttendance]
  );

  const handleRequestQrPort = useCallback(async () => {
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
  }, [activeSessionId]);

  const resetFlow = useCallback(() => {
    setStep("webauthn");
    setSelectedSession(null);
    setWebauthnVerified(false);
    setResult(null);
    setActiveSessionId(null);
    setSyncState(null);
    setSyncError(null);
    setRequestingQrPort(false);
    setQrPortStatusLocal(null);
  }, []);

  return (
    <div className="w-full max-w-none space-y-6">
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
            <span className="status-chip-soft">Verify Passkey → Select Session → Scan QR or BLE Beacon</span>
          </div>

          {step === "webauthn" && (
            <WebAuthnPrompt
              onVerified={handleWebAuthnVerified}
              triggerSignal={initialVerifyTrigger}
            />
          )}

          {step === "session" && (
            <div className="surface space-y-3 p-4 sm:p-5">
              <p className="text-sm font-medium">Select an active session</p>
              <p className="text-xs text-muted-foreground">
                Sessions are grouped by phase. Choose the active one for your class.
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
                      onClick={() => void handleSelectSession(s)}
                      className="w-full rounded-md border border-border px-4 py-3 text-left transition-colors hover:bg-accent"
                    >
                      <span className="font-medium">{s.course.code}</span>
                      <span className="text-muted-foreground"> — {s.course.name}</span>
                      <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {phaseLabel(s.phase)}
                      </span>
                      {s.hasMarked ? (
                        <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          Already marked
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "qr" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-background/40 px-3 py-2">
                <div className="text-sm font-medium">
                  Mode:{" "}
                  <span className="inline-flex items-center gap-1">
                    {scanMode === "BLE" ? (
                      <>
                        <Bluetooth className="h-4 w-4" />
                        Bluetooth
                      </>
                    ) : (
                      <>
                        <QrCode className="h-4 w-4" />
                        QR Code
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScanMode((current) => {
                      if (!sessionBle?.enabled) return "QR";
                      return current === "QR" ? "BLE" : "QR";
                    });
                  }}
                  disabled={!sessionBle?.enabled}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Switch
                </button>
              </div>

              {scanMode === "BLE" ? (
                <BleLecturerScanner
                  sessionId={selectedSession?.id ?? ""}
                  sessionBle={sessionBle}
                  onMarked={handleBleAttendance}
                />
              ) : (
                <div
                  className="flex min-h-[60dvh] flex-col justify-center py-4 md:min-h-0 md:py-0"
                  ref={(el) => {
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  <QrScanner
                    onScan={handleInitialQrScan}
                    openSignal={initialScanTrigger}
                    hideTriggerButton
                    description="Continuous scan is active. Invalid or expired codes will prompt you and keep scanning."
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {hasDevice && step === "result" && result && (
        <div className="space-y-4">
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
            <div className="space-y-3 rounded-lg border border-border/70 bg-background/40 p-4">
              <div className="status-panel p-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10" />
                <p className="mt-2 font-semibold">
                  {result.alreadyMarked ? "Attendance already marked" : "Attendance complete"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedSession
                    ? `${selectedSession.course.code} — ${phaseLabel(selectedSession.phase)}`
                    : "Session completed"}
                </p>
              </div>

              <div className="rounded-lg border border-border p-4">
                <p className="mb-3 text-sm font-medium">Verification Layers</p>
                <div className="space-y-2">
                  <LayerRow
                    icon={<Fingerprint className="h-4 w-4" />}
                    label="WebAuthn Biometric"
                    passed={result.layers.webauthn}
                    points={50}
                  />
                  <LayerRow
                    icon={
                      result.layers.ble ? (
                        <Bluetooth className="h-4 w-4" />
                      ) : (
                        <QrCode className="h-4 w-4" />
                      )
                    }
                    label={result.layers.ble ? "Lecturer BLE Beacon" : "Live QR Token"}
                    passed={result.layers.ble || result.layers.qr}
                    points={50}
                  />
                </div>
              </div>

              {activeSessionId && (
                <div className="surface-muted space-y-3 p-3">
                  <div className="flex items-start gap-2">
                    <Share2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Share Live QR Stream</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        After lecturer approval, this device mirrors the live QR sequence for nearby classmates.
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
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={resetFlow}
                  className="inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  Mark Another Session
                </button>
                <Link
                  href="/student"
                  className="inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  Go to Dashboard
                </Link>
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
  icon: ReactNode;
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

function BleLecturerScanner({
  sessionId,
  sessionBle,
  onMarked,
}: {
  sessionId: string;
  sessionBle: SessionBleState | null;
  onMarked: (params: BleScanTokenResult) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [tokenResult, setTokenResult] = useState<BleScanTokenResult | null>(null);

  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" &&
      window.isSecureContext &&
      typeof navigator !== "undefined" &&
      Boolean((navigator as any).bluetooth);
    setSupported(isSupported);
  }, []);

  const parseTokenCharacteristicValue = useCallback(
    (value: DataView): BleScanTokenResult => {
      const decoded = new TextDecoder().decode(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      );
      const parsed = JSON.parse(decoded) as Partial<BleScanTokenResult> & {
        sessionId?: string;
      };

      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid token payload format from BLE characteristic.");
      }

      if (parsed.sessionId !== sessionId) {
        throw new Error("Scanned BLE token belongs to a different session.");
      }

      if (
        parsed.phase !== "INITIAL" &&
        parsed.phase !== "REVERIFY"
      ) {
        throw new Error("BLE token payload has invalid phase.");
      }
      const tokenTimestamp =
        typeof (parsed as any).tokenTimestamp === "number"
          ? (parsed as any).tokenTimestamp
          : typeof (parsed as any).ts === "number"
            ? (parsed as any).ts
            : Number.NaN;

      if (
        typeof parsed.token !== "string" ||
        parsed.token.trim().length === 0 ||
        typeof parsed.sequence !== "number" ||
        !Number.isFinite(parsed.sequence) ||
        !Number.isFinite(tokenTimestamp)
      ) {
        throw new Error("BLE token payload is incomplete.");
      }

      return {
        token: parsed.token,
        sequence: parsed.sequence,
        phase: parsed.phase,
        tokenTimestamp,
      };
    },
    [sessionId]
  );

  useEffect(() => {
    if (!sessionBle?.enabled) {
      setSelectedName(null);
      setTokenResult(null);
    }
  }, [sessionBle?.enabled]);

  const handleSearch = useCallback(async () => {
    if (!supported) {
      toast.error("Web Bluetooth is not available on this device/browser.");
      return;
    }
    if (!sessionBle?.beaconName || !sessionBle.serviceUuid) {
      toast.error("BLE manifest is missing for this session. Use QR mode.");
      return;
    }

    setSearching(true);
    let gattServer: any = null;
    try {
      const bluetooth = (navigator as any).bluetooth;
      // requestDevice only returns a selected device; it does not provide RSSI.
      const device = await bluetooth.requestDevice({
        filters: [
          {
            namePrefix: ATTENDANCE_BLE.NAME_PREFIX,
            services: [sessionBle.serviceUuid],
          },
        ],
        optionalServices: [sessionBle.serviceUuid],
      });

      const discoveredName =
        typeof device?.name === "string" && device.name.trim().length > 0
          ? device.name.trim()
          : sessionBle.beaconName;

      gattServer = await device.gatt?.connect();
      if (!gattServer) {
        throw new Error("Selected device does not expose a GATT server.");
      }
      const service = await gattServer.getPrimaryService(sessionBle.serviceUuid);
      const tokenCharacteristic = await service.getCharacteristic(
        sessionBle.currentTokenCharacteristicUuid
      );
      const tokenValue = await tokenCharacteristic.readValue();
      const parsedToken = parseTokenCharacteristicValue(tokenValue);

      setSelectedName(discoveredName);
      setTokenResult({
        ...parsedToken,
        beaconName: discoveredName,
      });
      toast.success(`BLE token read from ${discoveredName}`);
    } catch (error: any) {
      if (error?.name !== "NotFoundError") {
        toast.error(error?.message || "BLE scan/read failed.");
      }
    } finally {
      if (gattServer?.connected && typeof gattServer.disconnect === "function") {
        try {
          gattServer.disconnect();
        } catch {
          // Best-effort disconnect.
        }
      }
      setSearching(false);
    }
  }, [parseTokenCharacteristicValue, sessionBle, supported]);

  if (!sessionBle?.enabled) {
    return (
      <div className="status-panel-subtle p-4 text-sm">
        Lecturer BLE broadcast is not active for this session. Use QR scan.
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="status-panel-subtle p-4 text-sm">
        Web Bluetooth is unavailable on this device/browser. Use QR scan.
      </div>
    );
  }

  return (
    <div className="surface space-y-3 p-4">
      <p className="text-sm font-semibold">Scan Lecturer Bluetooth Beacon</p>
      <p className="text-xs text-muted-foreground">
        Discover a beacon with the attendance service UUID, then read the rotating token.
      </p>
      <div className="rounded-md border border-border/70 bg-background/40 p-3 text-xs">
        Expected beacon name:{" "}
        <span className="font-semibold">
          {sessionBle.beaconName ?? "Not provided"}
        </span>
        <p className="mt-1 text-muted-foreground">
          Service UUID: {sessionBle.serviceUuid}
        </p>
        <p className="text-muted-foreground">
          Manufacturer: 0x{sessionBle.manufacturerCompanyId.toString(16).toUpperCase()} · Data: {sessionBle.manufacturerDataHex ?? "N/A"}
        </p>
      </div>
      {!sessionBle.active ? (
        <div className="status-panel-subtle p-3 text-xs">
          Broadcaster heartbeat not seen yet. If lecturer uses external broadcaster, continue scanning anyway.
        </div>
      ) : null}
      <button
        type="button"
        onClick={handleSearch}
        disabled={searching}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
        Scan Beacon
      </button>

      {selectedName && tokenResult ? (
        <div className="space-y-3 rounded-md border border-border/70 bg-background/40 p-3">
          <p className="text-sm font-medium">Selected: {selectedName}</p>
          <p className="text-xs text-muted-foreground">
            Token sequence: E{String(tokenResult.sequence).padStart(3, "0")} · {tokenResult.phase === "INITIAL" ? "Phase 1" : "Phase 2"}
          </p>
          <button
            type="button"
            onClick={() => onMarked(tokenResult)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Mark Attendance via Bluetooth
          </button>
        </div>
      ) : null}
    </div>
  );
}
