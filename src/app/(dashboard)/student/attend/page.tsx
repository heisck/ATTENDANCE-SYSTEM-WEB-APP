"use client";

import { useEffect, useState } from "react";
import { QrScanner } from "@/components/qr-scanner";
import { GpsCheck } from "@/components/gps-check";
import { WebAuthnPrompt } from "@/components/webauthn-prompt";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Fingerprint,
  MapPin,
  QrCode,
  Wifi,
} from "lucide-react";

type Step = "webauthn" | "gps" | "qr" | "submitting" | "result";

interface LayerResult {
  webauthn: boolean;
  gps: boolean;
  qr: boolean;
  ip: boolean;
}

interface AttendanceResult {
  success: boolean;
  confidence: number;
  flagged: boolean;
  gpsDistance: number;
  layers: LayerResult;
  error?: string;
}

export default function AttendPage() {
  const [step, setStep] = useState<Step>("webauthn");
  const [webauthnVerified, setWebauthnVerified] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [result, setResult] = useState<AttendanceResult | null>(null);
  const [hasDevice, setHasDevice] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkDevice() {
      try {
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

    checkDevice();
  }, []);

  function handleWebAuthnVerified() {
    setWebauthnVerified(true);
    setStep("gps");
  }

  function handleGpsReady(lat: number, lng: number, accuracy: number) {
    setGps({ lat, lng, accuracy });
    setStep("qr");
  }

  async function handleQrScan(data: { sessionId: string; token: string; ts: number }) {
    if (!gps) return;

    setStep("submitting");

    try {
      const res = await fetch("/api/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: data.sessionId,
          qrToken: data.token,
          qrTimestamp: data.ts,
          gpsLat: gps.lat,
          gpsLng: gps.lng,
          gpsAccuracy: gps.accuracy,
          webauthnVerified,
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        setResult({
          success: false,
          confidence: 0,
          flagged: true,
          gpsDistance: 0,
          layers: { webauthn: false, gps: false, qr: false, ip: false },
          error: body.error,
        });
      } else {
        setResult({
          success: true,
          confidence: body.record.confidence,
          flagged: body.record.flagged,
          gpsDistance: body.record.gpsDistance,
          layers: body.record.layers,
        });
      }
      setStep("result");
    } catch {
      setResult({
        success: false,
        confidence: 0,
        flagged: true,
        gpsDistance: 0,
        layers: { webauthn: false, gps: false, qr: false, ip: false },
        error: "Network error. Please try again.",
      });
      setStep("result");
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mark Attendance</h1>
        <p className="text-muted-foreground">
          Complete all verification steps to mark your attendance
        </p>
      </div>

      <div className="flex items-center gap-2">
        {["webauthn", "gps", "qr", "result"].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                step === s
                  ? "bg-primary text-primary-foreground"
                  : ["webauthn", "gps", "qr", "submitting", "result"].indexOf(step) > i
                    ? "bg-green-100 text-green-700"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {["webauthn", "gps", "qr", "submitting", "result"].indexOf(step) > i ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                i + 1
              )}
            </div>
            {i < 3 && (
              <div className={`h-0.5 w-8 ${
                ["webauthn", "gps", "qr", "submitting", "result"].indexOf(step) > i
                  ? "bg-green-300"
                  : "bg-muted"
              }`} />
            )}
          </div>
        ))}
      </div>

      {hasDevice === null && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Checking registered devices...</p>
        </div>
      )}

      {hasDevice === false && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 space-y-3">
          <p className="font-semibold text-yellow-800">No registered device found</p>
          <p className="text-sm text-yellow-700">
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

      {hasDevice && step === "webauthn" && (
        <WebAuthnPrompt onVerified={handleWebAuthnVerified} />
      )}

      {hasDevice && step === "gps" && (
        <GpsCheck onLocationReady={handleGpsReady} />
      )}

      {hasDevice && step === "qr" && (
        <QrScanner onScan={handleQrScan} />
      )}

      {hasDevice && step === "submitting" && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="font-medium">Verifying attendance...</p>
          <p className="text-sm text-muted-foreground">
            Running 4-layer verification pipeline
          </p>
        </div>
      )}

      {hasDevice && step === "result" && result && (
        <div className="space-y-4">
          <div
            className={`flex flex-col items-center gap-3 rounded-lg border p-8 ${
              result.success
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            {result.success ? (
              <>
                <CheckCircle2 className="h-16 w-16 text-green-600" />
                <p className="text-xl font-bold text-green-800">
                  Attendance Marked!
                </p>
                <p className="text-sm text-green-600">
                  Confidence Score: {result.confidence}%
                  {result.flagged && " (Flagged for review)"}
                </p>
              </>
            ) : (
              <>
                <XCircle className="h-16 w-16 text-red-600" />
                <p className="text-xl font-bold text-red-800">
                  Attendance Failed
                </p>
                <p className="text-sm text-red-600">{result.error}</p>
              </>
            )}
          </div>

          {result.success && (
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-sm font-medium">Verification Layers</p>
              <div className="space-y-2">
                <LayerRow
                  icon={<Fingerprint className="h-4 w-4" />}
                  label="WebAuthn Biometric"
                  passed={result.layers.webauthn}
                  points={40}
                />
                <LayerRow
                  icon={<MapPin className="h-4 w-4" />}
                  label={`GPS Proximity (${Math.round(result.gpsDistance)}m)`}
                  passed={result.layers.gps}
                  points={30}
                />
                <LayerRow
                  icon={<QrCode className="h-4 w-4" />}
                  label="QR Token"
                  passed={result.layers.qr}
                  points={20}
                />
                <LayerRow
                  icon={<Wifi className="h-4 w-4" />}
                  label="Campus Network"
                  passed={result.layers.ip}
                  points={10}
                />
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setStep("webauthn");
              setWebauthnVerified(false);
              setGps(null);
              setResult(null);
            }}
            className="w-full rounded-md border border-border py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            Mark Another Session
          </button>
        </div>
      )}
    </div>
  );
}

function LayerRow({
  icon,
  label,
  passed,
  points,
}: {
  icon: React.ReactNode;
  label: string;
  passed: boolean;
  points: number;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={passed ? "text-green-600" : "text-muted-foreground"}>
          {icon}
        </span>
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-medium ${
            passed ? "text-green-600" : "text-muted-foreground"
          }`}
        >
          {passed ? `+${points}` : "+0"}
        </span>
        {passed ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}
