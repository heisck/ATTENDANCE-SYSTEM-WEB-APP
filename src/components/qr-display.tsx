"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import QRCode from "qrcode";
import { Loader2, Maximize2, Minimize2, Sun } from "lucide-react";

interface QrDisplayProps {
  sessionId: string;
  mode?: "lecturer" | "port";
}

export function QrDisplay({ sessionId, mode = "lecturer" }: QrDisplayProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const nextRotateAtServerRef = useRef<number>(Date.now() + 5000);
  const rotationWindowRef = useRef<number>(5000);
  const clockOffsetRef = useRef<number>(0);
  const pendingDataUrlRef = useRef<string | null>(null);
  const pendingSequenceIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"INITIAL" | "REVERIFY" | "CLOSED">("INITIAL");
  const [phaseEndsAt, setPhaseEndsAt] = useState<string | null>(null);
  const [sequenceId, setSequenceId] = useState<string>("E000");
  const [nextSequenceId, setNextSequenceId] = useState<string>("E001");
  const [cueColor, setCueColor] = useState<string>("green");
  const [countdownMs, setCountdownMs] = useState<number>(5000);
  const [brightnessBoost, setBrightnessBoost] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const buildDataUrl = useCallback(async (payload: unknown) => {
    const svg = await QRCode.toString(JSON.stringify(payload), {
      type: "svg",
      width: 1024,
      margin: 4,
      color: { dark: "#000000", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    });
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, []);

  const bumpSequenceId = useCallback((value: string): string => {
    const parsed = Number.parseInt(value.replace(/^E/i, ""), 10);
    if (!Number.isFinite(parsed)) return value;
    return `E${String(parsed + 1).padStart(3, "0")}`;
  }, []);

  const fetchAndRender = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const endpoint = mode === "port" ? "qr-port" : "qr";
      const res = await fetch(`/api/attendance/sessions/${sessionId}/${endpoint}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch QR");
      }

      const {
        qr,
        nextRotationMs,
        nextRotationAtTs,
        serverNowTs,
        phase,
        phaseEndsAt,
        sequenceId,
        nextSequenceId,
        nextQr,
        cueColor,
        rotationMs,
      } = await res.json();
      const [dataUrl, nextDataUrl] = await Promise.all([
        buildDataUrl(qr),
        buildDataUrl(nextQr ?? qr),
      ]);

      setQrDataUrl(dataUrl);
      setPhase(phase);
      setPhaseEndsAt(phaseEndsAt ?? null);
      setSequenceId(sequenceId ?? "E000");
      setNextSequenceId(nextSequenceId ?? "E001");
      setCueColor(cueColor ?? "green");
      const safeRotationMs =
        typeof rotationMs === "number" && rotationMs > 0 ? rotationMs : 5000;
      const safeNextRotationMs =
        typeof nextRotationMs === "number" && nextRotationMs > 0
          ? nextRotationMs
          : safeRotationMs;

      if (typeof serverNowTs === "number" && Number.isFinite(serverNowTs)) {
        clockOffsetRef.current = serverNowTs - Date.now();
      }

      rotationWindowRef.current = safeRotationMs;
      pendingDataUrlRef.current = nextDataUrl;
      pendingSequenceIdRef.current = nextSequenceId ?? bumpSequenceId(sequenceId ?? "E000");

      if (typeof nextRotationAtTs === "number" && Number.isFinite(nextRotationAtTs)) {
        nextRotateAtServerRef.current = nextRotationAtTs;
      } else {
        nextRotateAtServerRef.current =
          Date.now() + clockOffsetRef.current + safeNextRotationMs;
      }
      setCountdownMs(
        Math.max(
          0,
          nextRotateAtServerRef.current - (Date.now() + clockOffsetRef.current)
        )
      );
      setError("");
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    } finally {
      isFetchingRef.current = false;
    }
  }, [bumpSequenceId, buildDataUrl, mode, sessionId]);

  useEffect(() => {
    void fetchAndRender();
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchAndRender();
      }
    }, 15_000);
    return () => window.clearInterval(heartbeat);
  }, [fetchAndRender]);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      const nowServer = Date.now() + clockOffsetRef.current;
      const remainingMs = nextRotateAtServerRef.current - nowServer;

      if (remainingMs <= 0) {
        const pendingDataUrl = pendingDataUrlRef.current;
        const pendingSequenceId = pendingSequenceIdRef.current;
        if (pendingDataUrl && pendingSequenceId) {
          setQrDataUrl(pendingDataUrl);
          setSequenceId(pendingSequenceId);
          setNextSequenceId(bumpSequenceId(pendingSequenceId));
          pendingDataUrlRef.current = null;
          pendingSequenceIdRef.current = null;
        }

        nextRotateAtServerRef.current += rotationWindowRef.current;
        setCountdownMs(0);
        void fetchAndRender();
        return;
      }

      setCountdownMs(remainingMs);
    }, 50);

    return () => window.clearInterval(ticker);
  }, [bumpSequenceId, fetchAndRender]);

  useEffect(() => {
    const onFullScreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullScreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullScreenChange);
  }, []);

  const cueStyles = useMemo(() => {
    if (cueColor === "blue") return "border-border bg-muted text-foreground";
    if (cueColor === "amber") return "border-border bg-muted/80 text-foreground";
    return "border-border bg-muted/60 text-foreground";
  }, [cueColor]);
  const cueDotClass = useMemo(() => {
    if (cueColor === "blue") return "bg-foreground/90";
    if (cueColor === "amber") return "bg-foreground/70";
    return "bg-foreground/55";
  }, [cueColor]);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement && wrapperRef.current) {
        await wrapperRef.current.requestFullscreen();
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Some browsers block fullscreen without direct gesture context.
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex aspect-square w-full max-w-[560px] items-center justify-center rounded-2xl border border-border bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex aspect-square w-full max-w-[560px] items-center justify-center rounded-2xl border border-destructive bg-destructive/5 p-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="mx-auto w-full max-w-[760px] space-y-3">
      <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
            Now: {sequenceId}
          </span>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium`}>
            Next: {nextSequenceId}
          </span>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium ${cueStyles}`}>
            Rotates in {(Math.max(0, countdownMs) / 1000).toFixed(1)}s
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBrightnessBoost((value) => !value)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            <Sun className="h-3.5 w-3.5" />
            {brightnessBoost ? "Brightness +" : "Normal Brightness"}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>

      <div
        className="mx-auto w-full max-w-[560px] overflow-hidden rounded-2xl border-2 border-border bg-white p-2"
        style={brightnessBoost ? { filter: "brightness(1.2) contrast(1.15)" } : undefined}
      >
        {qrDataUrl && (
          <div className="relative mx-auto aspect-square w-full">
            <img
              src={qrDataUrl}
              alt={`Attendance QR Code ${sequenceId}`}
              className="h-full w-full object-contain"
            />
            <div
              className={`pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${cueDotClass}`}
            />
          </div>
        )}
      </div>

      <div className="space-y-1 text-center">
        <p className="text-xs font-medium text-foreground">
          Phase: {phase === "INITIAL" ? "Phase 1" : phase === "REVERIFY" ? "Phase 2" : "Closed"}
        </p>
        {phaseEndsAt && (
          <p className="text-[11px] text-muted-foreground">
            Phase ends at {new Date(phaseEndsAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
