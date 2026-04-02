"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { QrScanner, type QrScanPayload, type QrScanResult } from "@/components/qr-scanner";
import { FaceLivenessCapture } from "@/components/face-liveness-capture";
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
  ShieldCheck,
  XCircle,
} from "lucide-react";

type Step = "webauthn" | "session" | "qr" | "face" | "result";
type QrPortStatus = "PENDING" | "APPROVED" | "REJECTED" | null;
type ScanMode = "QR" | "BLE";
type PendingPhase = "PHASE_ONE" | "PHASE_TWO" | null;

interface StudentPhaseCompletion {
  phaseOneDone: boolean;
  phaseTwoDone: boolean;
  overallPresent: boolean;
  pendingPhase: PendingPhase;
}

interface ActiveSession {
  id: string;
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  course: { code: string; name: string };
  hasMarked?: boolean;
  layers?: LayerResult;
  canMarkPhase?: boolean;
  blockReason?: string | null;
  phaseCompletion?: StudentPhaseCompletion | null;
}

interface LayerResult {
  webauthn: boolean | null;
  qr: boolean | null;
  ble: boolean | null;
  face?: boolean | null;
}

interface AttendanceResult {
  success: boolean;
  confidence: number;
  flagged: boolean;
  layers: LayerResult;
  alreadyMarked?: boolean;
  provisional?: boolean;
  phaseCompletion?: StudentPhaseCompletion | null;
  error?: string;
}

interface PendingFaceVerification {
  id: string;
  expiresAt: string;
  layers: LayerResult;
}

interface FaceVerificationCapture {
  sessionId: string;
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: string | null;
  };
}

interface SessionSyncResponse {
  serverNow?: string;
  session: {
    id: string;
    status: "ACTIVE" | "CLOSED";
    phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
    phaseEndsAt: string;
    currentSequenceId: string;
    nextSequenceId: string;
  };
  attendance: {
    id: string;
    markedAt: string;
    flagged: boolean;
    confidence: number;
    layers?: LayerResult;
  } | null;
  qrPortStatus?: QrPortStatus;
  phaseCompletion?: StudentPhaseCompletion | null;
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
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  phaseEndsAt: string;
}

interface BleScanTokenResult {
  token: string;
  sequence: number;
  phase: "PHASE_ONE" | "PHASE_TWO";
  tokenTimestamp: number;
  beaconName?: string;
  signalStrength?: number;
}

const DEVICE_TOKEN_STORAGE_KEY = "attendanceiq:web-device-token:v1";

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
    mobile?: boolean;
    brands?: Array<{ brand: string; version: string }>;
  };
};

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

function buildBrowserDeviceFingerprint() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "";
  }

  const nav = navigator as NavigatorWithUserAgentData;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : window.matchMedia?.("(prefers-color-scheme: light)").matches
      ? "light"
      : "no-preference";

  return JSON.stringify({
    version: 1,
    platform: nav.userAgentData?.platform || nav.platform || "unknown",
    language: nav.language || "en-US",
    languages: Array.isArray(nav.languages) ? nav.languages.slice(0, 5) : [],
    timezone,
    screen:
      typeof window.screen !== "undefined"
        ? `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`
        : "unknown",
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    deviceMemory:
      typeof (nav as Navigator & { deviceMemory?: number }).deviceMemory === "number"
        ? (nav as Navigator & { deviceMemory?: number }).deviceMemory
        : null,
    touchPoints: typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0,
    vendor: nav.vendor || "unknown",
    cookieEnabled: nav.cookieEnabled ?? false,
    colorScheme,
  });
}

function detectBrowserFamily() {
  if (typeof navigator === "undefined") {
    return "Web";
  }

  const nav = navigator as NavigatorWithUserAgentData;
  const platform =
    nav.userAgentData?.platform ||
    (typeof navigator.platform === "string" ? navigator.platform : "") ||
    navigator.userAgent ||
    "";

  if (/android/i.test(platform)) return "Android";
  if (/(iphone|ipad|ipod)/i.test(platform)) return "iOS";
  return "Web";
}

function checkBleSupport() {
  if (typeof window === "undefined") {
    return { supported: false, reason: "Not in browser context" };
  }

  const hasWebBluetooth = (navigator as any).bluetooth !== undefined;
  const isSecureContext = window.isSecureContext;

  if (!isSecureContext) {
    return { supported: false, reason: "HTTPS required" };
  }

  if (!hasWebBluetooth) {
    return {
      supported: false,
      reason: "Web Bluetooth not available on this device/browser",
    };
  }

  return { supported: true };
}

function phaseLabel(phase: ActiveSession["phase"]) {
  if (phase === "PHASE_ONE") return "Phase 1";
  if (phase === "PHASE_TWO") return "Phase 2";
  return "Closed";
}

function canOpenSessionStatus(session: ActiveSession) {
  return (
    session.canMarkPhase !== false ||
    session.hasMarked === true ||
    session.phaseCompletion?.overallPresent === true
  );
}

function buildFaceRecognitionFailureMessage(message: string) {
  const normalized = message.trim();
  if (!normalized) {
    return "Face recognition failed. Please try again.";
  }

  if (/^face recognition failed/i.test(normalized)) {
    return normalized;
  }

  return `Face recognition failed. ${normalized}`;
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
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ActiveSession | null>(null);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SessionSyncResponse | null>(null);
  const [sessionBle, setSessionBle] = useState<SessionBleState | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>("QR");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [bleSupport, setBleSupport] = useState<{ supported: boolean; reason?: string }>({
    supported: false,
  });

  const [requestingQrPort, setRequestingQrPort] = useState(false);
  const [qrPortStatusLocal, setQrPortStatusLocal] = useState<QrPortStatus>(null);
  const [initialVerifyTrigger, setInitialVerifyTrigger] = useState(0);
  const [initialScanTrigger, setInitialScanTrigger] = useState(0);
  const [showPortVerifyOverlay, setShowPortVerifyOverlay] = useState(false);
  const [pendingFaceVerification, setPendingFaceVerification] =
    useState<PendingFaceVerification | null>(null);
  const [faceCapture, setFaceCapture] = useState<FaceVerificationCapture | null>(null);
  const [faceCaptureLoading, setFaceCaptureLoading] = useState(false);
  const [faceSubmitting, setFaceSubmitting] = useState(false);
  const [faceError, setFaceError] = useState<string | null>(null);
  const previousQrPortStatusRef = useRef<QrPortStatus>(null);

  const qrPortStatus = syncState?.qrPortStatus ?? qrPortStatusLocal ?? null;

  const mapSessions = (data: any[]): ActiveSession[] =>
    data.map((s: any) => ({
      id: s.id,
      phase: s.phase ?? "PHASE_ONE",
      course: s.course ?? { code: s.courseCode ?? "", name: s.courseName ?? "" },
      hasMarked: s.hasMarked ?? false,
      layers: s.layers,
      canMarkPhase: typeof s.canMarkPhase === "boolean" ? s.canMarkPhase : true,
      blockReason: typeof s.blockReason === "string" ? s.blockReason : null,
      phaseCompletion:
        s.phaseCompletion && typeof s.phaseCompletion === "object"
          ? s.phaseCompletion
          : null,
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
    setSessionsError(null);
    try {
      const res = await fetch("/api/attendance/sessions?status=ACTIVE", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sessions");
      setSessions(Array.isArray(data) ? mapSessions(data) : []);
    } catch (error: any) {
      setSessions([]);
      setSessionsError(error?.message || "Failed to load active sessions.");
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
          if (status.requiresFaceEnrollment) {
            router.push("/student/enroll-face");
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

  const syncActiveSession = useCallback(
    async (sessionId: string) => {
      try {
        const body = await fetchSessionSync(sessionId);
        if (body.session.status !== "ACTIVE") {
          setActiveSessionId(null);
          setStep("session");
          setSelectedSession(null);
          await loadSessions();
          toast.info("This session has ended. Select an active session to continue.");
          return null;
        }

        let bleState: SessionBleState | null = null;
        try {
          bleState = await fetchSessionBle(sessionId);
        } catch {
          setSessionBle(null);
        }

        return { body, bleState };
      } catch (error: any) {
        setSyncError(error.message || "Failed to sync session.");
        return null;
      }
    },
    [fetchSessionBle, fetchSessionSync, loadSessions]
  );

  useEffect(() => {
    if (!syncError) return;
    toast.error(syncError);
  }, [syncError]);

  useEffect(() => {
    setBleSupport(checkBleSupport());
  }, []);

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

  useEffect(() => {
    if (
      step !== "result" ||
      !activeSessionId ||
      !result?.success ||
      qrPortStatus !== "PENDING"
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void syncActiveSession(activeSessionId);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [activeSessionId, qrPortStatus, result?.success, step, syncActiveSession]);

  useEffect(() => {
    const previous = previousQrPortStatusRef.current;
    if (qrPortStatus === "APPROVED" && previous !== "APPROVED") {
      setShowPortVerifyOverlay(true);
      toast.success("QR port approved. Verify passkey to start porting.");
    }
    previousQrPortStatusRef.current = qrPortStatus;
  }, [qrPortStatus]);

  const handleWebAuthnVerified = useCallback(() => {
    setWebauthnVerified(true);
    setStep("session");
    void loadSessions();
  }, [loadSessions]);

  const beginFaceVerificationCapture = useCallback(async (pendingVerificationId: string) => {
    setFaceCaptureLoading(true);
    setFaceError(null);
    setFaceCapture(null);

    try {
      const response = await fetch("/api/face/attendance/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingVerificationId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to start face verification.");
      }
      setFaceCapture(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start face verification.";
      setFaceError(message);
      toast.error(message);
    } finally {
      setFaceCaptureLoading(false);
    }
  }, []);

  const handleFaceVerificationFailure = useCallback((message: string) => {
    setFaceCapture(null);
    setFaceCaptureLoading(false);
    setFaceError(buildFaceRecognitionFailureMessage(message));
  }, []);

  const finalizeFaceVerification = useCallback(async () => {
    if (!pendingFaceVerification || !faceCapture) {
      throw new Error("Face verification is no longer ready. Start a new capture.");
    }

    setFaceSubmitting(true);
    try {
      const response = await fetch("/api/face/attendance/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pendingVerificationId: pendingFaceVerification.id,
          livenessSessionId: faceCapture.sessionId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to finalize face verification.");
      }

      setResult({
        success: true,
        confidence: data.record.confidence,
        flagged: data.record.flagged,
        layers: data.record.layers,
        phaseCompletion: data.phaseCompletion ?? null,
      });
      setPendingFaceVerification(null);
      setFaceCapture(null);
      setFaceError(null);
      setStep("result");
      if (data.phaseCompletion?.overallPresent) {
        toast.success("Attendance complete for Phase 1 and Phase 2.");
      } else if (data.phaseCompletion?.pendingPhase) {
        toast.success(`Phase 1 verified. Pending ${phaseLabel(data.phaseCompletion.pendingPhase)}.`);
      } else {
        toast.success("Phase 1 verified and recorded successfully.");
      }
      void loadSessions();
    } finally {
      setFaceSubmitting(false);
    }
  }, [faceCapture, loadSessions, pendingFaceVerification]);

  const handleSelectSession = useCallback(
    async (session: ActiveSession) => {
      const canReviewLockedSession =
        session.hasMarked === true || session.phaseCompletion?.overallPresent === true;

      if (session.canMarkPhase === false && !canReviewLockedSession) {
        toast.error(session.blockReason || "Complete Phase 1 first before marking Phase 2.");
        return;
      }

      setSelectedSession(session);
      setActiveSessionId(session.id);
      setScanMode("QR");

      const synced = await syncActiveSession(session.id);
      if (!synced) {
        return;
      }

      if (
        session.phase === "PHASE_TWO" &&
        synced.body.phaseCompletion &&
        !synced.body.phaseCompletion.phaseOneDone
      ) {
        toast.error("Phase 1 must be completed before Phase 2 for this class.");
        setStep("session");
        return;
      }

      if (synced.bleState?.enabled && synced.bleState.active) {
        setScanMode(detectBrowserFamily() === "Android" && bleSupport.supported ? "BLE" : "QR");
      }

      if (session.hasMarked || synced.body.attendance || canReviewLockedSession) {
        const derivedLayers =
          synced.body.attendance?.layers ??
          session.layers ?? {
            webauthn: null,
            qr: null,
            ble: null,
          };

        setResult({
          success: true,
          confidence: synced.body.attendance?.confidence ?? 100,
          flagged: synced.body.attendance?.flagged ?? false,
          layers: derivedLayers,
          alreadyMarked: true,
          phaseCompletion: synced.body.phaseCompletion ?? session.phaseCompletion ?? null,
        });
        setStep("result");
        if (session.blockReason) {
          toast.info(session.blockReason);
        }
        return;
      }

      setResult(null);
      setStep("qr");
    },
    [bleSupport.supported, syncActiveSession]
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
        const browserFamily = detectBrowserFamily();
        const deviceToken = getOrCreateBrowserDeviceToken();
        const deviceFingerprint = buildBrowserDeviceFingerprint();

        const res = await fetch("/api/attendance/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: data.sessionId,
            qrToken: data.token,
            qrTimestamp: data.ts,
            webauthnVerified,
            deviceToken,
            deviceName: `${browserFamily} Browser`,
            deviceType: "Web",
            osVersion: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
            appVersion: "web",
            deviceFingerprint,
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
            layers: { webauthn: false, qr: false, ble: false, face: false },
            error: message,
          });
          setStep("result");
          return "stop";
        }

        if (body.requiresFaceVerification) {
          setPendingFaceVerification({
            id: body.pendingVerificationId,
            expiresAt: body.expiresAt,
            layers: body.layers ?? { webauthn: true, qr: true, ble: null, face: null },
          });
          setActiveSessionId(data.sessionId);
          setFaceCapture(null);
          setResult(null);
          setStep("face");
          toast.info(
            "Phase 1 scan is provisional until face liveness and face match succeed."
          );
          void beginFaceVerificationCapture(body.pendingVerificationId);
          return "accepted";
        }

        setResult({
          success: true,
          confidence: body.record.confidence,
          flagged: body.record.flagged,
          layers: body.record.layers,
          phaseCompletion: body.phaseCompletion ?? null,
        });
        setActiveSessionId(data.sessionId);
        setStep("result");
        if (body.phaseCompletion?.overallPresent) {
          toast.success("Attendance complete for Phase 1 and Phase 2.");
        } else if (body.phaseCompletion?.pendingPhase) {
          toast.success(`Phase recorded. Pending ${phaseLabel(body.phaseCompletion.pendingPhase)}.`);
        } else {
          toast.success("Attendance marked successfully.");
        }
        void loadSessions();
        return "accepted";
      } catch {
        toast.error("Network error. Camera stays open so you can scan again.");
        return "retry";
      }
    },
    [beginFaceVerificationCapture, loadSessions, selectedSession, webauthnVerified]
  );

  const submitBleAttendance = useCallback(
    async (payload: {
      sessionId: string;
      token: string;
      sequence: number;
      phase: "PHASE_ONE" | "PHASE_TWO";
      tokenTimestamp: number;
      beaconName?: string;
      bleSignalStrength?: number;
    }) => {
      const browserFamily = detectBrowserFamily();
      const deviceToken = getOrCreateBrowserDeviceToken();
      const deviceFingerprint = buildBrowserDeviceFingerprint();

      const res = await fetch("/api/attendance/ble-mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          webauthnVerified,
          deviceToken,
          deviceName: `${browserFamily} Browser`,
          deviceType: "Web",
          osVersion: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          appVersion: "web",
          deviceFingerprint,
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

        if (body.requiresFaceVerification) {
          setPendingFaceVerification({
            id: body.pendingVerificationId,
            expiresAt: body.expiresAt,
            layers: body.layers ?? { webauthn: true, qr: null, ble: true, face: null },
          });
          setActiveSessionId(selectedSession.id);
          setFaceCapture(null);
          setResult(null);
          setStep("face");
          toast.info(
            "Phase 1 scan is provisional until face liveness and face match succeed."
          );
          void beginFaceVerificationCapture(body.pendingVerificationId);
          return;
        }

        setResult({
          success: true,
          confidence: body.record.confidence,
          flagged: body.record.flagged,
          layers: body.record.layers,
          phaseCompletion: body.phaseCompletion ?? null,
        });
        setActiveSessionId(selectedSession.id);
        setStep("result");
        if (body.phaseCompletion?.overallPresent) {
          toast.success("Attendance complete for Phase 1 and Phase 2.");
        } else if (body.phaseCompletion?.pendingPhase) {
          toast.success(`Phase recorded. Pending ${phaseLabel(body.phaseCompletion.pendingPhase)}.`);
        } else {
          toast.success("Attendance marked successfully via Bluetooth beacon.");
        }
        void loadSessions();
      } catch (error: any) {
        toast.error(error.message || "Failed to mark attendance via Bluetooth");
      }
    },
    [beginFaceVerificationCapture, loadSessions, selectedSession, submitBleAttendance]
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
    setSessionsError(null);
    setRequestingQrPort(false);
    setQrPortStatusLocal(null);
    setPendingFaceVerification(null);
    setFaceCapture(null);
    setFaceCaptureLoading(false);
    setFaceSubmitting(false);
    setFaceError(null);
    setShowPortVerifyOverlay(false);
    previousQrPortStatusRef.current = null;
  }, []);

  const sharedResultActionClass =
    "inline-flex min-w-0 w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50";
  const qrPortAction =
    activeSessionId && qrPortStatus === "APPROVED" ? (
      <button
        type="button"
        onClick={() => setShowPortVerifyOverlay(true)}
        className={sharedResultActionClass}
      >
        <Fingerprint className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">Verify Passkey to Start Porting</span>
      </button>
    ) : activeSessionId && qrPortStatus == null ? (
      <button
        type="button"
        onClick={handleRequestQrPort}
        disabled={requestingQrPort}
        className={sharedResultActionClass}
      >
        {requestingQrPort ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Share2 className="h-4 w-4 shrink-0" />
        )}
        <span className="min-w-0 truncate">Request QR Port Access</span>
      </button>
    ) : null;

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
            <span className="status-chip-soft">
              Verify Passkey → Select Session → Scan QR or BLE Beacon → Face Verify Phase 1
            </span>
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
                <div className="space-y-2">
                  <div className="status-panel flex items-center justify-between gap-3">
                    <span>
                      No active sessions for your courses right now. Ask your lecturer to start a session.
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadSessions()}
                      className="inline-flex items-center justify-center rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                      aria-label="Retry loading sessions"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                  {sessionsError ? (
                    <p className="text-xs text-muted-foreground">
                      {sessionsError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => {
                    const canOpen = canOpenSessionStatus(s);

                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-disabled={!canOpen}
                        onClick={() => {
                          if (!canOpen) {
                            toast.error(
                              s.blockReason || "Complete Phase 1 first before marking Phase 2."
                            );
                            return;
                          }
                          void handleSelectSession(s);
                        }}
                        className={`w-full rounded-md border border-border px-4 py-3 text-left transition-colors ${
                          canOpen
                            ? "hover:bg-accent"
                            : "cursor-not-allowed opacity-60"
                        }`}
                      >
                        <span className="font-medium">{s.course.code}</span>
                        <span className="text-muted-foreground"> — {s.course.name}</span>
                        <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {phaseLabel(s.phase)}
                        </span>
                        {s.hasMarked ? (
                          <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            Marked this phase
                          </span>
                        ) : null}
                        {s.phaseCompletion?.overallPresent ? (
                          <span className="ml-2 inline-flex rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] text-foreground">
                            Present (Phase 1 + 2)
                          </span>
                        ) : s.canMarkPhase === false ? (
                          <span className="ml-2 inline-flex rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                            Phase 1 required first
                          </span>
                        ) : s.phaseCompletion?.pendingPhase ? (
                          <span className="ml-2 inline-flex rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                            Pending {phaseLabel(s.phaseCompletion.pendingPhase)}
                          </span>
                        ) : null}
                        {s.hasMarked || s.phaseCompletion?.overallPresent ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Attendance is already recorded for this active session. Open it to view
                            status or manage QR port sharing.
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
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
                      if (!bleSupport.supported) return "QR";
                      return current === "QR" ? "BLE" : "QR";
                    });
                  }}
                  disabled={!sessionBle?.enabled || !bleSupport.supported}
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

          {step === "face" && pendingFaceVerification && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/70 bg-background/40 p-4">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border/70 bg-muted/35">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">
                      {faceError ? "Face recognition failed" : "Complete Live Face Verification"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {faceError
                        ? faceError
                        : "Phase 1 stays provisional until face liveness and face match succeed."}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pending request expires at{" "}
                      {new Date(pendingFaceVerification.expiresAt).toLocaleTimeString()}.
                    </p>
                  </div>
                </div>
              </div>

              {faceCaptureLoading ? (
                <div className="flex min-h-[16rem] items-center justify-center rounded-2xl border border-border/70 bg-background/40">
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Starting face verification...
                  </div>
                </div>
              ) : faceCapture ? (
                <FaceLivenessCapture
                  sessionId={faceCapture.sessionId}
                  region={faceCapture.region}
                  credentials={faceCapture.credentials}
                  title="Phase 1 Face Verification"
                  description="Stay centered in good lighting. Attendance is finalized only after this live check succeeds."
                  submitting={faceSubmitting}
                  onComplete={finalizeFaceVerification}
                  onFailure={handleFaceVerificationFailure}
                  onCancel={() => {
                    setFaceCapture(null);
                    setFaceError("Face verification was cancelled. Start a new capture to continue.");
                  }}
                />
              ) : (
                <div className="surface-muted space-y-3 p-4">
                  <p className="text-sm text-muted-foreground">
                    {faceError || "Face verification is not active yet."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void beginFaceVerificationCapture(pendingFaceVerification.id)}
                      className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <RefreshCw className="h-4 w-4" />
                      {faceError ? "Retry Face Verification" : "Start Face Verification"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep("qr")}
                      className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                    >
                      Back to Scan
                    </button>
                  </div>
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
                  {result.phaseCompletion?.overallPresent
                    ? "Attendance complete (Phase 1 + Phase 2)"
                    : result.phaseCompletion?.pendingPhase === "PHASE_TWO"
                      ? "Phase 1 recorded. Pending Phase 2"
                      : result.phaseCompletion?.pendingPhase === "PHASE_ONE"
                        ? "Phase 1 required before Phase 2"
                        : result.alreadyMarked
                          ? "Attendance already marked for this phase"
                          : "Phase attendance recorded"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedSession
                    ? `${selectedSession.course.code} — ${phaseLabel(selectedSession.phase)}`
                    : "Session completed"}
                </p>
                {!result.phaseCompletion?.overallPresent &&
                result.phaseCompletion?.pendingPhase ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pending {phaseLabel(result.phaseCompletion.pendingPhase)} to finalize attendance.
                  </p>
                ) : null}
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
                      result.layers.ble === true ? (
                        <Bluetooth className="h-4 w-4" />
                      ) : (
                        <QrCode className="h-4 w-4" />
                      )
                    }
                    label={result.layers.ble === true ? "Lecturer BLE Beacon" : "Live QR Token"}
                    passed={
                      result.layers.ble === null && result.layers.qr === null
                        ? null
                        : result.layers.ble === true || result.layers.qr === true
                    }
                    points={50}
                  />
                  {selectedSession?.phase === "PHASE_ONE" || result.layers.face !== undefined ? (
                    <LayerRow
                      icon={<ShieldCheck className="h-4 w-4" />}
                      label="Live Face Match"
                      passed={result.layers.face ?? null}
                      points={50}
                    />
                  ) : null}
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
                        Approved. Verify your passkey to open the dedicated QR port screen.
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
                    <div className="status-panel-subtle text-xs">
                      No QR port request yet. You can request access below if classmates need to
                      scan from your device.
                    </div>
                  )}
                </div>
              )}

              <div
                className={`grid gap-2 ${
                  qrPortAction ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                {qrPortAction}
                <Link
                  href="/student"
                  className={sharedResultActionClass}
                >
                  <span className="min-w-0 truncate">Go to Dashboard</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {showPortVerifyOverlay && activeSessionId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-background p-4 shadow-2xl">
            <div>
              <p className="text-base font-semibold">Verify Passkey to Start QR Port</p>
              <p className="text-sm text-muted-foreground">
                Passkey verification is required before this device can broadcast the live QR stream.
              </p>
            </div>

            <WebAuthnPrompt
              onVerified={() => {
                setShowPortVerifyOverlay(false);
                router.push(`/student/attend/port?sessionId=${encodeURIComponent(activeSessionId)}`);
              }}
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowPortVerifyOverlay(false)}
                className="inline-flex rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  passed: boolean | null;
  points: number;
}) {
  const isPassed = passed === true;
  const isUnknown = passed === null;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={isPassed ? "text-foreground" : "text-muted-foreground"}>
          {icon}
        </span>
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-medium ${
            isPassed ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {isUnknown ? "Unknown" : isPassed ? `+${points}` : "+0"}
        </span>
        {isUnknown ? (
          <span className="text-xs text-muted-foreground">-</span>
        ) : isPassed ? (
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
        parsed.phase !== "PHASE_ONE" &&
        parsed.phase !== "PHASE_TWO"
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
          BLE needs a fresh lecturer heartbeat and lease. QR remains available while the broadcaster is starting or unavailable.
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
            Token sequence: E{String(tokenResult.sequence).padStart(3, "0")} · {tokenResult.phase === "PHASE_ONE" ? "Phase 1" : "Phase 2"}
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
