"use client";

import { useState, useRef, useEffect } from "react";
import { Camera, CheckCircle2, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import ElasticSlider from "@/components/ui/elastic-slider";

interface QrScannerProps {
  onScan: (data: { sessionId: string; token: string; ts: number }) => void;
}

export function QrScanner({ onScan }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanning, setScanning] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(3);
  const [zoomStep, setZoomStep] = useState(0.1);
  const [zoomValue, setZoomValue] = useState(1);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  async function startCamera() {
    setError("");
    setVideoReady(false);
    setScanning(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === "function") {
        const caps: any = track.getCapabilities();
        if (caps?.zoom) {
          const min = Number(caps.zoom.min ?? 1);
          const max = Number(caps.zoom.max ?? 3);
          const step = Number(caps.zoom.step ?? 0.1);
          setZoomSupported(true);
          setZoomMin(min);
          setZoomMax(max);
          setZoomStep(step);
          setZoomValue(min);
          try {
            await track.applyConstraints({
              advanced: [{ zoom: min } as any],
            });
          } catch {
            // Continue with default zoom if the browser rejects zoom constraints.
          }
        } else {
          setZoomSupported(false);
          setZoomMin(1);
          setZoomMax(3);
          setZoomStep(0.1);
          setZoomValue(1);
        }
      }

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      if (!videoRef.current) {
        setError("Unable to start camera preview. Please try again.");
        stopCamera();
        return;
      }

      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => {
        setError("Unable to start camera preview. Please try again.");
        stopCamera();
      });
    } catch {
      setError("Camera access denied. Please allow camera permissions.");
      setScanning(false);
    }
  }

  function stopCamera() {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
    setVideoReady(false);
    setZoomValue(1);
  }

  useEffect(() => {
    if (!scanning || scanned) return;

    let animFrame: number;
    const scan = () => {
      if (!videoRef.current || !canvasRef.current) {
        animFrame = requestAnimationFrame(scan);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx || video.videoWidth === 0) {
        animFrame = requestAnimationFrame(scan);
        return;
      }

      const frameWidth = video.videoWidth;
      const frameHeight = video.videoHeight;
      canvas.width = frameWidth;
      canvas.height = frameHeight;

      if (!zoomSupported && zoomValue > 1) {
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
        // @ts-ignore - jsQR loaded via dynamic import
        if (typeof window !== "undefined" && (window as any).jsQR) {
          const code = (window as any).jsQR(
            imageData.data,
            imageData.width,
            imageData.height
          );
          if (code) {
            const parsed = JSON.parse(code.data);
            if (parsed.sessionId && parsed.token && parsed.ts) {
              setScanned(true);
              stopCamera();
              onScan(parsed);
              return;
            }
          }
        }
      } catch {
        // continue scanning
      }

      animFrame = requestAnimationFrame(scan);
    };

    animFrame = requestAnimationFrame(scan);
    return () => cancelAnimationFrame(animFrame);
  }, [scanning, scanned, onScan]);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
    script.async = true;
    document.head.appendChild(script);

    return () => {
      stopCamera();
      document.head.removeChild(script);
    };
  }, []);

  async function handleZoomChange(value: number) {
    setZoomValue(value);
    if (!zoomSupported || !streamRef.current) return;

    try {
      const track = streamRef.current.getVideoTracks()[0];
      await track.applyConstraints({
        advanced: [{ zoom: value } as any],
      });
    } catch {
      // Keep scanning with last known value if applyConstraints fails.
    }
  }

  if (scanned) {
    return (
      <div className="status-panel flex flex-col items-center gap-4 p-8 text-center">
        <CheckCircle2 className="h-12 w-12" />
        <p className="font-medium">QR Code Scanned</p>
        <p className="text-sm text-muted-foreground">Processing your attendance...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!scanning ? (
        <button
          onClick={startCamera}
          className="flex w-full flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border p-12 hover:border-primary hover:bg-accent/50 transition-colors"
        >
          <Camera className="h-12 w-12 text-muted-foreground" />
          <span className="font-medium">Tap to Open Camera</span>
          <span className="text-sm text-muted-foreground">
            Point at the QR code displayed by your lecturer
          </span>
        </button>
      ) : (
        <div className="flex flex-col items-center w-full">
          <div className="relative w-full max-w-[min(100vw-2rem,420px)] mx-auto min-h-[min(50vh,320px)] aspect-[4/3] rounded-xl overflow-hidden border-2 border-border bg-black shadow-lg [aspect-ratio:4/3]">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              playsInline
              muted
              onLoadedData={() => setVideoReady(true)}
            />
            {!videoReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <div className="flex items-center gap-2 rounded-md bg-black/70 px-3 py-2 text-sm text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting camera...
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-1/2 h-48 w-48 sm:h-56 sm:w-56 -translate-x-1/2 -translate-y-1/2 rounded-xl border-4 border-white/85" />
              <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/50 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/50 to-transparent" />
              <p className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-md bg-black/55 px-2 py-1 text-xs text-white whitespace-nowrap">
                Align QR within frame
              </p>
            </div>
          </div>
          <div className="mt-3 flex w-full max-w-[min(100vw-2rem,400px)] flex-col gap-2">
            <div className="rounded-lg bg-muted/50 px-3 py-3">
              <div className="flex items-center justify-between text-xs">
                <span>{zoomSupported ? "Camera zoom" : "Digital zoom"}</span>
                <span>{zoomValue.toFixed(1)}x</span>
              </div>
              <ElasticSlider
                className="mt-1 pb-4"
                leftIcon={<ZoomOut className="h-4 w-4" />}
                rightIcon={<ZoomIn className="h-4 w-4" />}
                startingValue={zoomMin}
                defaultValue={zoomValue}
                value={zoomValue}
                maxValue={zoomMax}
                isStepped={zoomStep > 0}
                stepSize={zoomStep}
                valueFormatter={(value) => `${value.toFixed(1)}x`}
                onValueChange={(value) => {
                  void handleZoomChange(Number(value.toFixed(2)));
                }}
              />
            </div>
            <button
              onClick={stopCamera}
              className="w-full rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
