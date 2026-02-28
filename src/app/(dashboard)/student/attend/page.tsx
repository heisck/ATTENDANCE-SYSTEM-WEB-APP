"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QrScanner, type QrScanPayload, type QrScanResult } from "@/components/qr-scanner";
import { QrDisplay } from "@/components/qr-display";
import { GpsCheck } from "@/components/gps-check";
import { WebAuthnPrompt } from "@/components/webauthn-prompt";
import { BleProximityCheck } from "@/components/ble-proximity-check";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Fingerprint,
  MapPin,
  QrCode,
  AlertTriangle,
  Clock,
  RefreshCcw,
  Share2,
  Loader2,
} from "lucide-react";

type Step = "webauthn" | "session" | "gps" | "qr" | "result";
type QrPortStatus = "PENDING" | "APPROVED" | "REJECTED" | null;
type AttendPageStage = "prepare" | "scan" | "phase1" | "reverify" | "complete";

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
    reverifyRequestedAt: string | null;
    reverifyDeadlineAt: string | null;
    reverifySlotStartsAt: string | null;
    reverifySlotEndsAt: string | null;
    reverifyTargetSequence: number | null;
    reverifyTargetSequenceId: string | null;
    reverifyPromptAt: string | null;
    reverifyNotifyLeadMs: number;
    reverifyBatchNumber: number | null;
    reverifyTotalBatches: number | null;
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

function normalizeAttendStage(value: string | null): AttendPageStage | null {
  if (
    value === "prepare" ||
    value === "scan" ||
    value === "phase1" ||
    value === "reverify" ||
    value === "complete"
  ) {
    return value;
  }
  return null;
}

export default function AttendPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("webauthn");
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
  const [reverifyError, setReverifyError] = useState<string | null>(null);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [initialVerifyTrigger, setInitialVerifyTrigger] = useState(0);
  const [initialScanTrigger, setInitialScanTrigger] = useState(0);
  const [reverifyVerifyTrigger, setReverifyVerifyTrigger] = useState(0);
  const [reverifyScanTrigger, setReverifyScanTrigger] = useState(0);
  const reverifyToastKeyRef = useRef<string | number | null>(null);

  const reverifyStatus = syncState?.attendance?.reverifyStatus;
  const isPendingReverify =
    reverifyStatus === "PENDING" || reverifyStatus === "RETRY_PENDING";
  const qrPortStatus = syncState?.qrPortStatus ?? qrPortStatusLocal ?? null;
  const reverifyNowTs = clockTick + serverClockOffsetMs;
  const reverifySlotStartsAtTs = syncState?.attendance?.reverifySlotStartsAt
    ? new Date(syncState.attendance.reverifySlotStartsAt).getTime()
    : null;
  const reverifySlotEndsAtTs = syncState?.attendance?.reverifySlotEndsAt
    ? new Date(syncState.attendance.reverifySlotEndsAt).getTime()
    : null;
  const reverifyPromptAtTs = syncState?.attendance?.reverifyPromptAt
    ? new Date(syncState.attendance.reverifyPromptAt).getTime()
    : null;
  const reverifyTargetSequenceId = syncState?.attendance?.reverifyTargetSequenceId ?? null;
  const reverifyBatchLabel =
    syncState?.attendance?.reverifyBatchNumber && syncState?.attendance?.reverifyTotalBatches
      ? `${syncState.attendance.reverifyBatchNumber}/${syncState.attendance.reverifyTotalBatches}`
      : null;
  const reverifySlotActive =
    reverifySlotStartsAtTs !== null &&
    reverifySlotEndsAtTs !== null &&
    reverifyNowTs >= reverifySlotStartsAtTs &&
    reverifyNowTs <= reverifySlotEndsAtTs;
  const reverifySecondsToStart =
    reverifySlotStartsAtTs !== null
      ? Math.max(0, Math.ceil((reverifySlotStartsAtTs - reverifyNowTs) / 1000))
      : null;
  const attendStage: AttendPageStage = normalizeAttendStage(searchParams.get("stage")) ?? "prepare";
  const attendanceState = syncState?.attendance;
  const reverifyFinished = attendanceState
    ? attendanceState.reverifyStatus === "PASSED" ||
      attendanceState.reverifyStatus === "MANUAL_PRESENT"
    : false;

  const setAttendStage = useCallback(
    (nextStage: AttendPageStage) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("mode");
      if (nextStage === "prepare") {
        params.delete("stage");
      } else {
        params.set("stage", nextStage);
      }

      const nextQuery = params.toString();
      const nextUrl = nextQuery ? `/student/attend?${nextQuery}` : "/student/attend";
      const currentQuery = searchParams.toString();
      const currentUrl = currentQuery ? `/student/attend?${currentQuery}` : "/student/attend";
      if (currentUrl === nextUrl) return;
      router.replace(nextUrl);
    },
    [router, searchParams]
  );

  const mapSessions = (data: any[]): ActiveSession[] =>
    data.map((s: any) => ({
      id: s.id,
      radiusMeters: s.radiusMeters ?? 50,
      course: s.course ?? { code: s.courseCode ?? "", name: s.courseName ?? "" },
      hasMarked: s.hasMarked ?? false,
    }));

  function showInitialFailure(errorMessage: string) {
    setResult({
      success: false,
      confidence: 0,
      flagged: true,
      gpsDistance: 0,
      layers: { webauthn: false, gps: false, qr: false, ip: false },
      error: errorMessage,
    });
    setStep("result");
  }

  useEffect(() => {
    const mode = searchParams.get("mode");
    if (mode !== "verify" && mode !== "scan") return;

    if (mode === "verify") {
      if (attendStage === "reverify") {
        if (!reverifyPasskeyVerified) {
          setReverifyVerifyTrigger((value) => value + 1);
        } else {
          toast.info("Passkey already verified for this reverification round.");
        }
      } else if (step === "webauthn") {
        setInitialVerifyTrigger((value) => value + 1);
      } else {
        toast.info("Passkey is already verified for this attendance flow.");
      }
    }

    if (mode === "scan") {
      if (attendStage === "scan" && step === "qr") {
        setInitialScanTrigger((value) => value + 1);
      } else if (attendStage === "reverify") {
        if (!reverifyPasskeyVerified) {
          toast.info("Verify passkey first.");
        } else if (!reverifySlotActive) {
          toast.info("Wait for your assigned QR slot to open.");
        } else {
          setReverifyScanTrigger((value) => value + 1);
        }
      } else {
        toast.info("Complete passkey, session selection, and GPS checks before scanning.");
      }
    }

    setAttendStage(attendStage);
  }, [
    attendStage,
    isPendingReverify,
    reverifyPasskeyVerified,
    reverifySlotActive,
    searchParams,
    setAttendStage,
    step,
  ]);

  useEffect(() => {
    if (step === "qr" && attendStage !== "scan") {
      setAttendStage("scan");
    }
  }, [attendStage, setAttendStage, step]);

  useEffect(() => {
    if (step !== "result" || !result?.success) return;
    if (attendStage === "phase1") {
      return;
    }
    if ((attendStage === "prepare" || attendStage === "scan") && activeSessionId) {
      setAttendStage("phase1");
      return;
    }
    if (attendStage === "reverify" && reverifyFinished) {
      setAttendStage("complete");
      return;
    }
    if (attendStage !== "complete" && attendStage !== "reverify") {
      setAttendStage("reverify");
    }
  }, [activeSessionId, attendStage, result?.success, reverifyFinished, setAttendStage, step]);

  useEffect(() => {
    if (step !== "result" || !result?.success || attendStage !== "phase1") return;

    const timer = window.setTimeout(() => {
      setAttendStage("reverify");
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [attendStage, result?.success, setAttendStage, step]);

  useEffect(() => {
    if (step === "qr" && attendStage === "scan") {
      setInitialScanTrigger((value) => value + 1);
    }
  }, [attendStage, step]);

  useEffect(() => {
    if (!isPendingReverify || !reverifyPasskeyVerified || !reverifySlotActive) return;
    if (attendStage !== "reverify") return;
    setReverifyScanTrigger((value) => value + 1);
  }, [attendStage, isPendingReverify, reverifyPasskeyVerified, reverifySlotActive]);

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
    if (hasDevice !== true || sessionsLoading) return;
    if (activeSessionId || result || step === "qr") return;

    const markedSession = sessions.find((session) => session.hasMarked);
    if (!markedSession) return;

    let cancelled = false;
    const resumeFlow = async () => {
      try {
        const res = await fetch(`/api/attendance/sessions/${markedSession.id}/me`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok || !body?.attendance || cancelled) return;

        if (typeof body.serverNow === "string") {
          const serverNowTs = new Date(body.serverNow).getTime();
          if (Number.isFinite(serverNowTs)) {
            setServerClockOffsetMs(serverNowTs - Date.now());
          }
        }

        setSelectedSession(markedSession);
        setActiveSessionId(markedSession.id);
        setSyncState(body);
        setQrPortStatusLocal(body.qrPortStatus ?? null);
        setResult({
          success: true,
          confidence: 100,
          flagged: Boolean(body.attendance.flagged),
          gpsDistance: 0,
          layers: { webauthn: true, gps: true, qr: true, ip: false },
        });
        setStep("result");

        const alreadyComplete =
          body.attendance.reverifyStatus === "PASSED" ||
          body.attendance.reverifyStatus === "MANUAL_PRESENT";
        setAttendStage(alreadyComplete ? "complete" : "reverify");
        if (!alreadyComplete) {
          toast.info("Attendance resumed. Continue with phase two verification.");
        }
      } catch {
        // Keep normal manual flow on transient errors.
      }
    };

    void resumeFlow();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, hasDevice, result, sessions, sessionsLoading, setAttendStage, step]);

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
          if (typeof body.serverNow === "string") {
            const serverNowTs = new Date(body.serverNow).getTime();
            if (Number.isFinite(serverNowTs)) {
              setServerClockOffsetMs(serverNowTs - Date.now());
            }
          }
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
      if (reverifyToastKeyRef.current) {
        toast.dismiss(reverifyToastKeyRef.current);
        reverifyToastKeyRef.current = null;
      }
    }
  }, [isPendingReverify]);

  useEffect(() => {
    if (!isPendingReverify) return;
    const t = setInterval(() => setClockTick(Date.now()), 250);
    return () => clearInterval(t);
  }, [isPendingReverify]);

  useEffect(() => {
    if (
      !isPendingReverify ||
      !reverifyPromptAtTs ||
      !reverifySlotStartsAtTs ||
      !reverifyTargetSequenceId ||
      reverifyNowTs < reverifyPromptAtTs
    ) {
      if (reverifyToastKeyRef.current) {
        toast.dismiss(reverifyToastKeyRef.current);
        reverifyToastKeyRef.current = null;
      }
      return;
    }

    const toastKey = `reverify-${activeSessionId}-${reverifyTargetSequenceId}-${reverifySlotStartsAtTs}`;
    if (reverifyToastKeyRef.current === toastKey) {
      return;
    }
    if (reverifyToastKeyRef.current) {
      toast.dismiss(reverifyToastKeyRef.current);
    }
    reverifyToastKeyRef.current = toastKey;

    const startLabel = new Date(reverifySlotStartsAtTs).toLocaleTimeString();
    const batchPrefix = reverifyBatchLabel ? `Batch ${reverifyBatchLabel}. ` : "";

    toast.info(`${batchPrefix}Scan ${reverifyTargetSequenceId} at ${startLabel}.`, {
      id: toastKey,
      duration: Infinity,
      description: "Complete passkey now and keep this page open for your exact slot.",
    });
  }, [
    activeSessionId,
    isPendingReverify,
    reverifyBatchLabel,
    reverifyNowTs,
    reverifyPromptAtTs,
    reverifySlotStartsAtTs,
    reverifyTargetSequenceId,
  ]);

  useEffect(
    () => () => {
      if (reverifyToastKeyRef.current) {
        toast.dismiss(reverifyToastKeyRef.current);
      }
    },
    []
  );

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
    setStep("session");
  }

  function handleGpsReady(lat: number, lng: number, accuracy: number) {
    setGps({ lat, lng, accuracy });
    setStep("qr");
    setAttendStage("scan");
  }

  async function handleInitialQrScan(data: QrScanPayload): Promise<QrScanResult> {
    if (!gps) {
      toast.error("Location check is still in progress. Wait a moment and scan again.");
      return "retry";
    }
    if (selectedSession && data.sessionId !== selectedSession.id) {
      const message =
        "This QR belongs to a different session. Please scan the QR for your selected course.";
      toast.error(message);
      return "retry";
    }

    try {
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const platform =
        typeof navigator !== "undefined" && typeof navigator.platform === "string"
          ? navigator.platform
          : "Web";
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const language = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
      const deviceToken = getOrCreateBrowserDeviceToken();

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

        const retryable = res.status === 400 || res.status === 429;
        if (retryable) {
          return "retry";
        }

        showInitialFailure(message);
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
      setAttendStage("phase1");
      toast.success("Attendance marked. Keep this page open for reverification updates.");
      return "accepted";
    } catch {
      toast.error("Network error. Camera stays open so you can scan again.");
      return "retry";
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
                    reverifyRequestedAt: body.record.reverifyRequestedAt,
                    reverifyDeadlineAt: body.record.reverifyDeadlineAt,
                    reverifySlotStartsAt: body.record.reverifyRequestedAt,
                    reverifySlotEndsAt: body.record.reverifyDeadlineAt,
                    reverifyTargetSequenceId: body.sequenceId ?? null,
                    reverifyPromptAt: body.record.reverifyRequestedAt
                      ? new Date(
                          new Date(body.record.reverifyRequestedAt).getTime() -
                            (current.attendance?.reverifyNotifyLeadMs ?? 10_000)
                        ).toISOString()
                      : null,
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

  async function handleReverifyQrScan(data: QrScanPayload): Promise<QrScanResult> {
    if (!activeSessionId) {
      return "stop";
    }
    if (data.sessionId !== activeSessionId) {
      setReverifyError("This QR belongs to a different session.");
      return "retry";
    }
    if (!reverifyPasskeyVerified) {
      setReverifyError("Passkey verification is required before scanning.");
      return "retry";
    }

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
        const message = body?.error || "Reverification failed";
        setReverifyError(message);
        return "retry";
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
      setAttendStage("complete");
      toast.success("Reverification completed.");
      return "accepted";
    } catch (error: any) {
      setReverifyError(error.message);
      return "retry";
    }
  }

  const reverifyMessage = useMemo(() => {
    if (!syncState?.attendance) return null;

    const attendance = syncState.attendance;
    if (!attendance.reverifyRequired) {
      return {
        tone: "neutral",
        title: "Phase two slot pending",
        body: "Stay on this page. Your reverification slot will be assigned automatically.",
      };
    }

    switch (attendance.reverifyStatus) {
      case "PENDING":
      case "RETRY_PENDING":
        {
          const sequenceText = attendance.reverifyTargetSequenceId
            ? `Scan ${attendance.reverifyTargetSequenceId}`
            : "Scan your assigned QR sequence";
          const batchText =
            attendance.reverifyBatchNumber && attendance.reverifyTotalBatches
              ? ` (Batch ${attendance.reverifyBatchNumber}/${attendance.reverifyTotalBatches})`
              : "";
        return {
          tone: "amber",
            title: `Reverification required${batchText}`,
          body: attendance.reverifyDeadlineAt
                ? `${sequenceText} before ${new Date(
                attendance.reverifyDeadlineAt
              ).toLocaleTimeString()}.`
                : `${sequenceText} now.`,
        };
        }
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
    setStep("webauthn");
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
    setReverifyError(null);
    setServerClockOffsetMs(0);
    setClockTick(Date.now());
    if (reverifyToastKeyRef.current) {
      toast.dismiss(reverifyToastKeyRef.current);
      reverifyToastKeyRef.current = null;
    }
    setAttendStage("prepare");
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

      {hasDevice && !result && attendStage === "prepare" && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="status-chip-soft">Phase 1: Passkey to Session to GPS to QR</span>
          </div>

          {step === "webauthn" && (
            <WebAuthnPrompt
              onVerified={handleWebAuthnVerified}
              triggerSignal={initialVerifyTrigger}
              hideActionButton
            />
          )}

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
                        if (s.hasMarked) {
                          toast.info("You already marked attendance for this session.");
                          return;
                        }
                        setSelectedSession(s);
                        setStep("gps");
                      }}
                      className="w-full rounded-md border border-border px-4 py-3 text-left transition-colors hover:bg-accent"
                    >
                      <span className="font-medium">{s.course.code}</span>
                      <span className="text-muted-foreground"> — {s.course.name}</span>
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

          {step === "gps" && (
            <GpsCheck
              onLocationReady={handleGpsReady}
              maxAccuracyMeters={selectedSession?.radiusMeters ?? 50}
            />
          )}
        </>
      )}

      {hasDevice && !result && attendStage === "scan" && step === "qr" && (
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

      {hasDevice && !result && attendStage === "scan" && step !== "qr" && (
        <div className="surface-muted p-4">
          <p className="text-sm font-semibold">Prepare scan first</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Verify passkey, select a live session, and complete location check before scanning.
          </p>
        </div>
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

          {result.success && attendStage === "phase1" && (
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

          {result.success && attendStage === "phase1" && (
            <div className="status-panel p-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10" />
              <p className="mt-2 font-semibold">Attendance complete</p>
              <p className="text-sm text-muted-foreground">
                Phase one completed, you will be redirected to begin phase two.
              </p>
            </div>
          )}

          {result.success && activeSessionId && attendStage === "reverify" && (
            <div className="space-y-3 rounded-lg border border-border/70 bg-background/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Reverification</p>
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
                <p className="text-sm text-muted-foreground">Waiting for attendance state sync...</p>
              )}

              {syncState?.attendance && reverifyMessage && (
                <div
                  className={`rounded-md border p-3 text-sm ${
                    reverifyMessage.tone === "neutral"
                      ? "border-border bg-muted/50 text-foreground"
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

              <div className="surface-muted space-y-3 p-3">
                <div className="flex items-start gap-2 text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Phase two verification</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Verify passkey now. The countdown starts once your assigned slot is ready.
                    </p>
                  </div>
                </div>

                {!reverifyPasskeyVerified ? (
                  <WebAuthnPrompt
                    onVerified={() => setReverifyPasskeyVerified(true)}
                    triggerSignal={reverifyVerifyTrigger}
                  />
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Passkey verified.</p>
                    {!isPendingReverify ? (
                      <div className="status-panel-subtle p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                          Waiting for your phase two slot assignment.
                        </p>
                      </div>
                    ) : !reverifySlotActive ? (
                      <div className="status-panel-subtle p-4 text-center">
                        {reverifySlotStartsAtTs &&
                        reverifySecondsToStart !== null &&
                        reverifySecondsToStart > 0 ? (
                          <>
                            <p className="text-lg font-semibold">
                              Waiting for {reverifyTargetSequenceId ?? "your slot"} in {reverifySecondsToStart}s
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Slot starts at {new Date(reverifySlotStartsAtTs).toLocaleTimeString()}.
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Waiting for your assigned slot window.
                          </p>
                        )}
                      </div>
                    ) : (
                      <QrScanner
                        onScan={handleReverifyQrScan}
                        openSignal={reverifyScanTrigger}
                        hideTriggerButton
                        description="Keep camera pointed at the live board. Scan continues until your exact slot is accepted."
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {result.success && activeSessionId && attendStage === "complete" && (
            <div className="space-y-3 rounded-lg border border-border/70 bg-background/40 p-4">
              <div className="status-panel p-4 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10" />
                <p className="mt-2 font-semibold">Attendance complete</p>
                <p className="text-sm text-muted-foreground">
                  Verification finished. You can request QR port access or return to dashboard.
                </p>
              </div>

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

              <Link
                href="/student"
                className="inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                Go to Dashboard
              </Link>
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
