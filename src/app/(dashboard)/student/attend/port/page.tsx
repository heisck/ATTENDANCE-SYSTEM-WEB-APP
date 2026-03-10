"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { QrDisplay } from "@/components/qr-display";
import { WebAuthnPrompt } from "@/components/webauthn-prompt";

export default function StudentQrPortPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = useMemo(() => {
    const raw = searchParams.get("sessionId");
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "";
  }, [searchParams]);

  const [verified, setVerified] = useState(false);
  const [stopping, setStopping] = useState(false);

  const stopPorting = useCallback(async () => {
    if (!sessionId) return false;
    setStopping(true);
    try {
      const res = await fetch("/api/attendance/qr-port/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || "Failed to stop QR porting.");
      }
      return true;
    } catch (error: any) {
      toast.error(error?.message || "Failed to stop QR porting.");
      return false;
    } finally {
      setStopping(false);
    }
  }, [sessionId]);

  const handleStop = useCallback(async () => {
    const ok = await stopPorting();
    if (ok) {
      toast.success("QR porting stopped.");
      router.push("/student");
    }
  }, [router, stopPorting]);

  const handleGoDashboard = useCallback(async () => {
    await stopPorting();
    router.push("/student");
  }, [router, stopPorting]);

  if (!sessionId) {
    return (
      <div className="surface-muted space-y-3 p-6">
        <p className="font-semibold">No session selected for QR porting.</p>
        <button
          type="button"
          onClick={() => router.push("/student/attend")}
          className="inline-flex rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Back to Mark Attendance
        </button>
      </div>
    );
  }

  if (!verified) {
    return (
      <div className="space-y-4">
        <div className="surface-muted p-4 text-sm text-muted-foreground">
          Verify your passkey before starting QR porting.
        </div>
        <WebAuthnPrompt onVerified={() => setVerified(true)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface-muted space-y-1 p-3">
        <p className="text-sm font-semibold">QR Port Active</p>
        <p className="text-xs text-muted-foreground">
          Keep this screen open so nearby classmates can scan the rotating code.
        </p>
      </div>

      <QrDisplay sessionId={sessionId} mode="port" />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleStop}
          disabled={stopping}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Stop QR Porting
        </button>
        <button
          type="button"
          onClick={handleGoDashboard}
          disabled={stopping}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}
