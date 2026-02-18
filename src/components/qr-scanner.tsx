"use client";

import { useState, useRef, useEffect } from "react";
import { Camera, CheckCircle2, XCircle } from "lucide-react";

interface QrScannerProps {
  onScan: (data: { sessionId: string; token: string; ts: number }) => void;
}

export function QrScanner({ onScan }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch {
      setError("Camera access denied. Please allow camera permissions.");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
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

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

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

  if (scanned) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-green-200 bg-green-50 p-8">
        <CheckCircle2 className="h-12 w-12 text-green-600" />
        <p className="font-medium text-green-800">QR Code Scanned!</p>
        <p className="text-sm text-green-600">Processing your attendance...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="h-4 w-4" />
          {error}
        </div>
      )}

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
        <div className="relative overflow-hidden rounded-lg border border-border">
          <video
            ref={videoRef}
            className="w-full"
            playsInline
            muted
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-48 w-48 rounded-lg border-2 border-white/80 shadow-lg" />
          </div>
          <button
            onClick={stopCamera}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/50 px-4 py-2 text-sm text-white hover:bg-black/70 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
