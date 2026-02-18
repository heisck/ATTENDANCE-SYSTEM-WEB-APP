"use client";

import { useState } from "react";
import { MapPin, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface GpsCheckProps {
  onLocationReady: (lat: number, lng: number, accuracy: number) => void;
}

export function GpsCheck({ onLocationReady }: GpsCheckProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error, setError] = useState("");

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
        onLocationReady(latitude, longitude, accuracy);
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

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPin className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">GPS Location</p>
            {status === "idle" && (
              <p className="text-xs text-muted-foreground">
                Required for proximity verification
              </p>
            )}
            {status === "loading" && (
              <p className="text-xs text-muted-foreground">
                Getting your location...
              </p>
            )}
            {status === "success" && coords && (
              <p className="text-xs text-green-600">
                Location acquired (±{Math.round(coords.accuracy)}m accuracy)
              </p>
            )}
            {status === "error" && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        </div>

        {status === "idle" && (
          <button
            onClick={requestLocation}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Enable GPS
          </button>
        )}
        {status === "loading" && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
        {status === "success" && <CheckCircle2 className="h-5 w-5 text-green-600" />}
        {status === "error" && (
          <button
            onClick={requestLocation}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
