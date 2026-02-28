"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Flashlight, FlashlightOff, Loader2, X } from "lucide-react";
import { toast } from "sonner";

export type QrScanPayload = {
  sessionId: string;
  token: string;
  ts: number;
};

export type QrScanResult = "accepted" | "retry" | "stop";

interface QrScannerProps {
  onScan: (data: QrScanPayload) => Promise<QrScanResult> | QrScanResult;
  autoOpen?: boolean;
  openSignal?: number;
  hideTriggerButton?: boolean;
  triggerLabel?: string;
  description?: string;
}

declare global {
  interface Window {
    jsQR?: (
      data: Uint8ClampedArray,
      width: number,
      height: number
    ) => { data: string } | null;
    __attendanceQrLoader?: Promise<void>;
  }
}

const SCAN_DECODE_INTERVAL_MS = 140;
const RETRY_SCAN_COOLDOWN_MS = 900;
const ZOOM_PRESETS = [0.5, 1, 3] as const;

type TouchListLike = {
  length: number;
  [index: number]: {
    clientX: number;
    clientY: number;
  };
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseQrPayload(raw: string): QrScanPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.sessionId === "string" &&
      typeof parsed?.token === "string" &&
      Number.isFinite(Number(parsed?.ts))
    ) {
      return {
        sessionId: parsed.sessionId,
        token: parsed.token,
        ts: Number(parsed.ts),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureJsQrLoaded() {
  if (typeof window === "undefined") return;
  if (typeof window.jsQR === "function") return;

  if (!window.__attendanceQrLoader) {
    window.__attendanceQrLoader = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-qr-lib="jsqr"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Failed to load QR decoder")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
      script.async = true;
      script.dataset.qrLib = "jsqr";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load QR decoder"));
      document.head.appendChild(script);
    });
  }

  await window.__attendanceQrLoader;
}

function getTouchDistance(touches: TouchListLike) {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

export function QrScanner({
  onScan,
  autoOpen = false,
  openSignal,
  hideTriggerButton = false,
  triggerLabel = "Open Camera",
  description = "Point your camera at the live rotating QR code.",
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const scanBusyRef = useRef(false);
  const nextScanAllowedAtRef = useRef(0);
  const lastDecodedKeyRef = useRef("");
  const lastDecodedAtRef = useRef(0);
  const lastDecodeTickRef = useRef(0);

  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(3);
  const [zoomValue, setZoomValue] = useState(1);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(1);
  const lastOpenSignalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const effectiveZoomMin = useMemo(() => (zoomSupported ? zoomMin : 1), [zoomMin, zoomSupported]);
  const effectiveZoomMax = useMemo(() => (zoomSupported ? zoomMax : 3), [zoomMax, zoomSupported]);

  async function applyZoom(requestedValue: number) {
    const nextValue = clamp(requestedValue, effectiveZoomMin, effectiveZoomMax);
    const normalized = Number(nextValue.toFixed(2));
    setZoomValue(normalized);

    if (!zoomSupported || !streamRef.current) return;

    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;
      await track.applyConstraints({
        advanced: [{ zoom: normalized } as any],
      });
    } catch {
      // Keep scanning if hardware zoom constraints are rejected.
    }
  }

  async function toggleTorch() {
    if (!streamRef.current || !torchSupported) return;

    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    const next = !torchEnabled;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as any],
      });
      setTorchEnabled(next);
    } catch {
      toast.error("Flash is not available on this camera.");
    }
  }

  function stopCamera() {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setCameraActive(false);
    setVideoReady(false);
    setProcessing(false);
    setTorchEnabled(false);
    scanBusyRef.current = false;
  }

  function closeOverlay() {
    stopCamera();
    setOverlayOpen(false);
  }

  async function startCamera() {
    if (cameraActive) return;

    try {
      setError("");
      setOverlayOpen(true);
      setVideoReady(false);
      await ensureJsQrLoaded();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === "function") {
        const caps = track.getCapabilities() as any;
        const canZoom = Boolean(caps?.zoom);
        const canTorch = caps?.torch === true;

        setTorchSupported(canTorch);
        setTorchEnabled(false);

        if (canZoom) {
          const min = Number(caps.zoom.min ?? 1);
          const max = Number(caps.zoom.max ?? 3);
          const initial = clamp(1, min, max);
          setZoomSupported(true);
          setZoomMin(min);
          setZoomMax(max);
          setZoomValue(initial);
          try {
            await track.applyConstraints({
              advanced: [{ zoom: initial } as any],
            });
          } catch {
            // Continue with default zoom if the browser rejects zoom constraints.
          }
        } else {
          setZoomSupported(false);
          setZoomMin(1);
          setZoomMax(3);
          setZoomValue(1);
          setTorchSupported(false);
          setTorchEnabled(false);
        }
      }

      if (!videoRef.current) {
        throw new Error("Unable to initialize camera preview.");
      }

      videoRef.current.setAttribute("playsinline", "true");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);
    } catch {
      setError("Unable to start camera. Please allow permission and try again.");
      setOverlayOpen(false);
      stopCamera();
    }
  }

  useEffect(() => {
    if (!autoOpen || overlayOpen || cameraActive) return;
    void startCamera();
  }, [autoOpen, overlayOpen, cameraActive]);

  useEffect(() => {
    if (openSignal === undefined || openSignal === 0) return;
    if (lastOpenSignalRef.current === openSignal) return;
    lastOpenSignalRef.current = openSignal;

    if (overlayOpen || cameraActive) return;
    void startCamera();
  }, [cameraActive, openSignal, overlayOpen]);

  useEffect(() => {
    if (!cameraActive) return;

    let frame = 0;
    const scan = () => {
      if (!videoRef.current || !canvasRef.current) {
        frame = requestAnimationFrame(scan);
        return;
      }

      const nowPerf = performance.now();
      if (nowPerf - lastDecodeTickRef.current < SCAN_DECODE_INTERVAL_MS) {
        frame = requestAnimationFrame(scan);
        return;
      }
      lastDecodeTickRef.current = nowPerf;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx || video.videoWidth === 0) {
        frame = requestAnimationFrame(scan);
        return;
      }

      const frameWidth = video.videoWidth;
      const frameHeight = video.videoHeight;
      canvas.width = frameWidth;
      canvas.height = frameHeight;

      if (!zoomSupported && zoomValue > 1.01) {
        // Fallback digital zoom for browsers that don't expose camera zoom controls.
        const srcW = frameWidth / zoomValue;
        const srcH = frameHeight / zoomValue;
        const srcX = (frameWidth - srcW) / 2;
        const srcY = (frameHeight - srcH) / 2;
        ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, frameWidth, frameHeight);
      } else {
        ctx.drawImage(video, 0, 0, frameWidth, frameHeight);
      }

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      try {
        if (typeof window !== "undefined" && typeof window.jsQR === "function") {
          const code = window.jsQR(imageData.data, imageData.width, imageData.height);
          if (code?.data) {
            const parsed = parseQrPayload(code.data);
            if (parsed) {
              const now = Date.now();
              const payloadKey = `${parsed.sessionId}:${parsed.token}:${parsed.ts}`;

              if (
                scanBusyRef.current ||
                now < nextScanAllowedAtRef.current ||
                (payloadKey === lastDecodedKeyRef.current && now - lastDecodedAtRef.current < 1200)
              ) {
                frame = requestAnimationFrame(scan);
                return;
              }

              scanBusyRef.current = true;
              lastDecodedKeyRef.current = payloadKey;
              lastDecodedAtRef.current = now;
              setProcessing(true);

              Promise.resolve(onScan(parsed))
                .then((result) => {
                  if (result === "accepted" || result === "stop") {
                    closeOverlay();
                    return;
                  }

                  nextScanAllowedAtRef.current = Date.now() + RETRY_SCAN_COOLDOWN_MS;
                })
                .catch(() => {
                  nextScanAllowedAtRef.current = Date.now() + RETRY_SCAN_COOLDOWN_MS;
                })
                .finally(() => {
                  scanBusyRef.current = false;
                  setProcessing(false);
                });
            }
          }
        }
      } catch {
        // continue scanning
      }

      frame = requestAnimationFrame(scan);
    };

    frame = requestAnimationFrame(scan);
    return () => cancelAnimationFrame(frame);
  }, [cameraActive, onScan, zoomSupported, zoomValue]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!overlayOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOverlay();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [overlayOpen]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    pinchStartDistanceRef.current = getTouchDistance(event.touches);
    pinchStartZoomRef.current = zoomValue;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || pinchStartDistanceRef.current === null) return;
    event.preventDefault();

    const currentDistance = getTouchDistance(event.touches);
    if (currentDistance <= 0) return;

    const pinchRatio = currentDistance / pinchStartDistanceRef.current;
    const nextZoom = pinchStartZoomRef.current * pinchRatio;
    void applyZoom(nextZoom);
  };

  const handleTouchEnd = () => {
    pinchStartDistanceRef.current = null;
  };

  return (
    <div className="space-y-3">
      {!overlayOpen ? (
        hideTriggerButton ? (
          <div className="rounded-xl border border-border bg-background/50 px-4 py-3 text-center text-sm text-muted-foreground">
            {description}
          </div>
        ) : (
          <button
            onClick={startCamera}
            className="flex w-full flex-col items-center gap-3 rounded-xl border border-border bg-background/70 p-8 transition-colors hover:bg-accent/50"
          >
            <Camera className="h-10 w-10 text-primary" />
            <span className="text-base font-semibold">{triggerLabel}</span>
            <span className="text-center text-sm text-muted-foreground">{description}</span>
          </button>
        )
      ) : (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/85 md:bg-black/70" />
          <div className="relative flex h-full w-full items-stretch justify-center md:items-start md:px-6 md:pt-6">
            <div
              ref={previewRef}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              className="relative h-full w-full overflow-hidden bg-black touch-none md:h-[68vh] md:max-h-[760px] md:w-[min(92vw,1080px)] md:rounded-3xl md:border md:border-white/20 md:shadow-2xl"
            >
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                style={!zoomSupported ? { transform: `scale(${zoomValue})` } : undefined}
                autoPlay
                playsInline
                muted
                onLoadedData={() => setVideoReady(true)}
              />

              {!videoReady && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65">
                  <div className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting camera...
                  </div>
                </div>
              )}

              {processing && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/35">
                  <div className="inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying scan...
                  </div>
                </div>
              )}

              <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between p-4">
                <div className="rounded-full bg-black/55 px-3 py-1 text-xs text-white/90">
                  Continuous scan active
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleTorch}
                    disabled={!torchSupported}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={torchEnabled ? "Turn flash off" : "Turn flash on"}
                  >
                    {torchEnabled ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={closeOverlay}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white"
                    aria-label="Close scanner"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 to-transparent" />

              <div className="absolute inset-x-0 bottom-0 z-30 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                <div className="rounded-2xl bg-black/55 p-3 text-white backdrop-blur">
                  <p className="text-center text-xs text-white/80">
                    Keep the rotating QR in view. Detection works anywhere in frame.
                  </p>
                  <div className="mt-3 flex items-center justify-center gap-2">
                    {ZOOM_PRESETS.map((preset) => {
                      const disabled = preset < effectiveZoomMin || preset > effectiveZoomMax;
                      const selected = Math.abs(zoomValue - preset) < 0.11;
                      return (
                        <button
                          key={preset}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            void applyZoom(preset);
                          }}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            selected
                              ? "bg-white text-black"
                              : "bg-white/15 text-white hover:bg-white/25"
                          } disabled:cursor-not-allowed disabled:opacity-30`}
                        >
                          {preset.toFixed(1)}x
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-2 px-2">
                    <input
                      type="range"
                      min={effectiveZoomMin}
                      max={effectiveZoomMax}
                      step={0.1}
                      value={zoomValue}
                      onChange={(event) => {
                        void applyZoom(Number(event.target.value));
                      }}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/25"
                      aria-label="Camera zoom"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}

      {!overlayOpen && error ? (
        <div className="status-panel-subtle text-sm">{error}</div>
      ) : null}
    </div>
  );
}
