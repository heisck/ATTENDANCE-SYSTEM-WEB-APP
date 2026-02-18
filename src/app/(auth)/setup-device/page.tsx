"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, CheckCircle2, Shield } from "lucide-react";

export default function SetupDevicePage() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function handleRegister() {
    setStatus("loading");
    setError("");

    try {
      const optionsRes = await fetch("/api/webauthn/register");
      if (!optionsRes.ok) throw new Error("Failed to get registration options");
      const options = await optionsRes.json();

      const registration = await startRegistration(options);

      const verifyRes = await fetch("/api/webauthn/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registration),
      });

      const result = await verifyRes.json();

      if (result.verified) {
        setStatus("success");
        setTimeout(() => router.push("/student"), 2000);
      } else {
        throw new Error("Verification failed");
      }
    } catch (err: any) {
      setStatus("error");
      setError(err.message || "Device registration failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div>
          <Shield className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-4 text-2xl font-bold">Setup Your Device</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Register your device&apos;s biometric (fingerprint or face) for
            secure attendance verification. This binds your account to this
            device.
          </p>
        </div>

        {status === "success" ? (
          <div className="space-y-4">
            <CheckCircle2 className="mx-auto h-16 w-16 text-green-500" />
            <p className="font-medium text-green-700">
              Device registered successfully!
            </p>
            <p className="text-sm text-muted-foreground">
              Redirecting to dashboard...
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              onClick={handleRegister}
              disabled={status === "loading"}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {status === "loading" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Fingerprint className="h-5 w-5" />
                  Register Biometric
                </>
              )}
            </button>

            <button
              onClick={() => router.push("/student")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
