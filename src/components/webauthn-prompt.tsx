"use client";

import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface WebAuthnPromptProps {
  onVerified: () => void;
  onSkipped?: () => void;
}

export function WebAuthnPrompt({ onVerified, onSkipped }: WebAuthnPromptProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

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
      const authentication = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/webauthn/authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authentication),
      });

      const result = await verifyRes.json();

      if (result.verified) {
        setStatus("success");
        onVerified();
      } else {
        throw new Error("Biometric verification failed");
      }
    } catch (err: any) {
      setStatus("error");
      if (err.message.includes("No credentials")) {
        setError("No device registered. Please register your biometric first.");
      } else {
        setError(err.message || "Verification failed");
      }
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Fingerprint className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Biometric Verification</p>
            {status === "idle" && (
              <p className="text-xs text-muted-foreground">
                Verify your identity with fingerprint or face
              </p>
            )}
            {status === "loading" && (
              <p className="text-xs text-muted-foreground">
                Waiting for biometric...
              </p>
            )}
            {status === "success" && (
              <p className="text-xs text-green-600">Identity verified</p>
            )}
            {status === "error" && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
        </div>

        {status === "idle" && (
          <div className="flex items-center gap-2">
            {onSkipped && (
              <button
                onClick={onSkipped}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={handleVerify}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Verify
            </button>
          </div>
        )}
        {status === "loading" && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
        {status === "success" && <CheckCircle2 className="h-5 w-5 text-green-600" />}
        {status === "error" && (
          <button
            onClick={handleVerify}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
