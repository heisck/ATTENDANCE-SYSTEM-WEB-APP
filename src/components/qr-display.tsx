"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import QRCode from "qrcode";
import { Loader2, Maximize2, Minimize2, Sun } from "lucide-react";

interface QrDisplayProps {
  sessionId: string;
}

export function QrDisplay({ sessionId }: QrDisplayProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"INITIAL" | "REVERIFY" | "CLOSED">("INITIAL");
  const [phaseEndsAt, setPhaseEndsAt] = useState<string | null>(null);
  const [sequenceId, setSequenceId] = useState<string>("E000");
  const [nextSequenceId, setNextSequenceId] = useState<string>("E001");
  const [upcomingSequenceIds, setUpcomingSequenceIds] = useState<string[]>([]);
  const [cueColor, setCueColor] = useState<string>("green");
  const [rotationMs, setRotationMs] = useState<number>(5000);
  const [countdownMs, setCountdownMs] = useState<number>(5000);
  const [brightnessBoost, setBrightnessBoost] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fetchAndRender = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}/qr`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch QR");
      }

      const {
        qr,
        nextRotationMs,
        phase,
        phaseEndsAt,
        sequenceId,
        nextSequenceId,
        upcomingSequenceIds,
        cueColor,
      } = await res.json();
      const payload = JSON.stringify(qr);

      const svg = await QRCode.toString(payload, {
        type: "svg",
        width: 1024,
        margin: 4,
        color: { dark: "#000000", light: "#FFFFFF" },
        errorCorrectionLevel: "M",
      });
      const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

      setQrDataUrl(dataUrl);
      setPhase(phase);
      setPhaseEndsAt(phaseEndsAt ?? null);
      setSequenceId(sequenceId ?? "E000");
      setNextSequenceId(nextSequenceId ?? "E001");
      setUpcomingSequenceIds(Array.isArray(upcomingSequenceIds) ? upcomingSequenceIds : []);
      setCueColor(cueColor ?? "green");
      setRotationMs(nextRotationMs);
      setCountdownMs(nextRotationMs);
      setError("");
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchAndRender();
    const interval = setInterval(fetchAndRender, 5000);
    return () => clearInterval(interval);
  }, [fetchAndRender]);

  useEffect(() => {
    if (!rotationMs) return;
    const ticker = setInterval(() => {
      setCountdownMs((value) => (value <= 100 ? rotationMs : value - 100));
    }, 100);

    return () => clearInterval(ticker);
  }, [rotationMs]);

  useEffect(() => {
    const onFullScreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullScreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullScreenChange);
  }, []);

  const cueStyles = useMemo(() => {
    if (cueColor === "blue") return "bg-blue-100 text-blue-700 border-blue-200";
    if (cueColor === "amber") return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-green-100 text-green-700 border-green-200";
  }, [cueColor]);
  const cueDotClass = useMemo(() => {
    if (cueColor === "blue") return "bg-blue-500";
    if (cueColor === "amber") return "bg-amber-500";
    return "bg-green-500";
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
      <div className="flex h-[400px] w-[400px] items-center justify-center rounded-lg border border-border bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[400px] w-[400px] items-center justify-center rounded-lg border border-destructive bg-destructive/5 p-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
            {sequenceId}
          </span>
          <span className={`rounded-md border px-2 py-1 text-xs font-medium ${cueStyles}`}>
            Scan {sequenceId} now
          </span>
        </div>
        <div className="flex items-center gap-2">
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
        className="overflow-hidden rounded-lg border-2 border-border bg-white p-2"
        style={brightnessBoost ? { filter: "brightness(1.2) contrast(1.15)" } : undefined}
      >
        {qrDataUrl && (
          <div className="relative mx-auto h-[65vmin] max-h-[900px] w-[65vmin] max-w-[900px]">
            <img
              src={qrDataUrl}
              alt={`Attendance QR Code ${sequenceId}`}
              className="h-full w-full"
            />
            <div
              className={`pointer-events-none absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${cueDotClass}`}
            />
          </div>
        )}
      </div>

      <div className="space-y-1 text-center">
        <p className="text-sm font-medium text-foreground">
          Next QR: {nextSequenceId} in {(countdownMs / 1000).toFixed(1)}s
        </p>
        <p className="text-xs text-muted-foreground">
          Upcoming: {upcomingSequenceIds.join(" | ") || "--"} (rotation every 5s)
        </p>
        <p className="text-xs font-medium text-foreground">
          Phase: {phase === "INITIAL" ? "Initial Attendance" : phase === "REVERIFY" ? "Reverification" : "Closed"}
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
