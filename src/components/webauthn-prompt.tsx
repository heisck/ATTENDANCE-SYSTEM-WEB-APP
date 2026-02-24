"use client";

import { useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface WebAuthnPromptProps {
  onVerified: () => void;
}

export function WebAuthnPrompt({ onVerified }: WebAuthnPromptProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "error" && error) toast.error(error);
  }, [error, status]);

  async function buildUserError(err: any): Promise<string> {
    const rawMessage = String(err?.message || "");
    const message = rawMessage.toLowerCase();
    const errorName = String(err?.name || "");

    if (message.includes("no credentials")) {
      return "No passkey is registered for your account. Contact your administrator.";
    }

    if (message.includes("locked")) {
      return "Your passkey registration is locked. Contact your administrator.";
    }

    if (errorName === "NotAllowedError" || message.includes("not allowed") || message.includes("timed out")) {
      try {
        const res = await fetch("/api/webauthn/devices");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.devices) && data.devices.length > 0) {
            return "Could not verify with a device passkey. Make sure you select the same passkey you registered on this device. If the issue persists, ask your administrator to reset your passkeys.";
          }
        }
      } catch {
        // Best effort check; fall through to generic message.
      }

      return "Verification was cancelled or timed out. Try again and approve the passkey prompt.";
    }

    return rawMessage || "Verification failed";
  }

  async function handleVerify() {
    setStatus("loading");
    setError("");

    try {
      const optionsRes = await fetch("/api/webauthn/authenticate");
      if (!optionsRes.ok) {
        const data = await optionsRes.json();
        throw new Error(data.error || "Failed to get options");
      }

      const options = await optionsRes.json();
      const authentication = await startAuthentication(options);

      const verifyRes = await fetch("/api/webauthn/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authentication),
      });

      const result = await verifyRes.json();

      if (result.verified) {
        setStatus("success");
        setTimeout(() => onVerified(), 1500);
      } else {
        throw new Error("Biometric verification failed");
      }
    } catch (err: any) {
      setStatus("error");
      setError(await buildUserError(err));
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-3">
            <Fingerprint className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Verify Your Identity</h2>
            <p className="text-sm text-muted-foreground">
              {status === "idle" && "Use your device's biometric to continue"}
              {status === "loading" && "Waiting for your biometric..."}
              {status === "success" && "Verified successfully!"}
              {status === "error" && "Verification failed"}
            </p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          {(status === "idle" || status === "error") && (
            <button
              onClick={handleVerify}
              className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Verify Passkey
            </button>
          )}

          {status === "success" && (
            <button
              disabled
              className="flex-1 rounded-md border border-border/70 bg-muted px-4 py-3 text-sm font-semibold text-foreground flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-5 w-5" />
              Verified
            </button>
          )}

          {status === "loading" && (
            <button
              disabled
              className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground opacity-50 flex items-center justify-center gap-2"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Waiting...
            </button>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Biometric verification is required to ensure only you can mark attendance.
        </p>
      </div>
    </div>
  );
}
