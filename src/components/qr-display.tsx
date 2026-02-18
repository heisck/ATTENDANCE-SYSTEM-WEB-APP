"use client";

import { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";

interface QrDisplayProps {
  sessionId: string;
}

export function QrDisplay({ sessionId }: QrDisplayProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchAndRender = useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}/qr`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch QR");
      }

      const { qr, nextRotationMs } = await res.json();
      const payload = JSON.stringify(qr);

      const dataUrl = await QRCode.toDataURL(payload, {
        width: 400,
        margin: 2,
        color: { dark: "#000000", light: "#FFFFFF" },
        errorCorrectionLevel: "M",
      });

      setQrDataUrl(dataUrl);
      setError("");
      setLoading(false);

      const timeout = Math.max(nextRotationMs, 500);
      const timer = setTimeout(fetchAndRender, timeout);
      return () => clearTimeout(timer);
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
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border-2 border-border bg-white p-2">
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt="Attendance QR Code"
            className="h-[400px] w-[400px]"
          />
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        QR rotates every 5 seconds &mdash; students must scan in person
      </p>
    </div>
  );
}
