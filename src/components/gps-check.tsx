"use client";

import { useState } from "react";
import { MapPin, Loader2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

interface GpsCheckProps {
  onLocationReady: (lat: number, lng: number, accuracy: number) => void;
  /** Max accuracy in meters to allow confirmation. Lower = stricter. Default 30m. */
  maxAccuracyMeters?: number;
}

export function GpsCheck({ onLocationReady, maxAccuracyMeters = 30 }: GpsCheckProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const accuracyOk = coords && coords.accuracy <= maxAccuracyMeters;

  function requestLocation() {
    setStatus("loading");
    setError("");

    if (!navigator.geolocation) {
      setStatus("error");
      setError("Geolocation is not supported by your browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setCoords({ lat: latitude, lng: longitude, accuracy });
        setStatus("success");
      },
      (err) => {
        setStatus("error");
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError("Location access denied. Please enable GPS permissions.");
            break;
          case err.POSITION_UNAVAILABLE:
            setError("Location information unavailable.");
            break;
          case err.TIMEOUT:
            setError("Location request timed out. Please try again.");
            break;
          default:
            setError("An unknown error occurred.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function handleConfirm() {
    if (coords && accuracyOk) {
      setConfirmed(true);
      onLocationReady(coords.lat, coords.lng, coords.accuracy);
    }
  }

  if (confirmed && coords) {
    return (
      <div className="status-panel">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Location confirmed</p>
            <p className="text-xs text-muted-foreground">
              ±{Math.round(coords.accuracy)}m accuracy
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm font-medium">GPS Location</p>
            {status === "idle" && (
              <p className="text-xs text-muted-foreground">
                Calibrate until accuracy is below {maxAccuracyMeters}m
              </p>
            )}
            {status === "loading" && (
              <p className="text-xs text-muted-foreground">
                Getting your location...
              </p>
            )}
            {status === "success" && coords && (
              <p className="text-xs font-medium text-foreground">
                Accuracy: ±{Math.round(coords.accuracy)}m
                {accuracyOk
                  ? " — Good, you can use this"
                  : ` — Re-measure for better (target: ≤${maxAccuracyMeters}m)`}
              </p>
            )}
            {status === "error" && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {status === "idle" && (
            <button
              onClick={requestLocation}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <MapPin className="h-4 w-4" />
              Get Location
            </button>
          )}
          {status === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calibrating...
            </div>
          )}
          {status === "success" && coords && (
            <>
              <button
                onClick={requestLocation}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Re-measure
              </button>
              <button
                onClick={handleConfirm}
                disabled={!accuracyOk}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <CheckCircle2 className="h-4 w-4" />
                Use this location
              </button>
            </>
          )}
          {status === "error" && (
            <button
              onClick={requestLocation}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
