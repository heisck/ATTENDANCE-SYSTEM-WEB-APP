"use client";

import { useState } from "react";
import { MapPin, Loader2, CheckCircle2, RefreshCw } from "lucide-react";

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
    <div className="space-y-3 rounded-xl border border-border p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
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

        <div className="w-full sm:w-auto sm:shrink-0">
          {status === "idle" && (
            <button
              onClick={requestLocation}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
            >
              <MapPin className="h-4 w-4" />
              Get Location
            </button>
          )}
          {status === "loading" && (
            <div className="flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-muted/30 px-4 text-sm text-muted-foreground sm:w-auto">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calibrating...
            </div>
          )}
          {status === "success" && coords && (
            <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-row">
              <button
                onClick={requestLocation}
                className="inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent sm:w-auto"
              >
                <RefreshCw className="h-4 w-4" />
                Re-measure
              </button>
              <button
                onClick={handleConfirm}
                disabled={!accuracyOk}
                className="inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <CheckCircle2 className="h-4 w-4" />
                Use this location
              </button>
            </div>
          )}
          {status === "error" && (
            <button
              onClick={requestLocation}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent sm:w-auto"
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
