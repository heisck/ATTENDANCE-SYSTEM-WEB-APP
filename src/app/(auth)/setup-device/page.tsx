"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, CheckCircle2, Shield, AlertCircle } from "lucide-react";

export default function SetupDevicePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [passkeysLockedUntilAdminReset, setPasskeysLockedUntilAdminReset] = useState(false);
  const [hasExistingPasskey, setHasExistingPasskey] = useState(false);
  const [checkingLock, setCheckingLock] = useState(true);

  useEffect(() => {
    checkStudentGateAndPasskeyState();
  }, []);

  async function checkStudentGateAndPasskeyState() {
    try {
      const statusRes = await fetch("/api/auth/student-status");
      if (statusRes.ok) {
        const status = await statusRes.json();
        if (status.role === "STUDENT" && (status.requiresProfileCompletion || !status.personalEmailVerified)) {
          router.push("/student/complete-profile");
          return;
        }
      }

      const res = await fetch("/api/webauthn/devices");
      if (!res.ok) return;
      const data = await res.json();
      const isLocked = Boolean(data.passkeysLockedUntilAdminReset);
      const hasPasskey = Array.isArray(data.devices) && data.devices.length > 0;
      setPasskeysLockedUntilAdminReset(isLocked);
      setHasExistingPasskey(hasPasskey);
      if (isLocked) {
        setStatus("error");
        setError("Your passkey registration is locked. Contact your administrator.");
      } else if (hasPasskey) {
        setStatus("error");
        setError("Delete your existing passkey first before registering a new one.");
      }
    } catch {
      // The register API still enforces lock checks; this pre-check only improves UX.
    } finally {
      setCheckingLock(false);
    }
  }

  async function handleRegister() {
    if (checkingLock) return;

    if (passkeysLockedUntilAdminReset) {
      setStatus("error");
      setError("Your passkey registration is locked. Contact your administrator.");
      return;
    }

    if (hasExistingPasskey) {
      setStatus("error");
      setError("Delete your existing passkey first before registering a new one.");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const optionsRes = await fetch("/api/webauthn/register");
      if (!optionsRes.ok) {
        const data = await optionsRes.json();
        throw new Error(data.error || "Failed to get registration options");
      }
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
        throw new Error(result.error || "Verification failed");
      }
    } catch (err: any) {
      setStatus("error");
      if (err.message.includes("locked")) {
        setError("Your passkey registration is locked. Contact your administrator.");
      } else if (err.message.toLowerCase().includes("existing passkey")) {
        setError("Delete your existing passkey first before registering a new one.");
      } else if (err.message.includes("timeout") || err.message.includes("not allowed")) {
        setError("Biometric verification was not completed. Please try again.");
      } else {
        setError(err.message || "Device registration failed");
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-border bg-card p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="flex justify-center">
              <div className="rounded-full bg-primary/10 p-4">
                <Shield className="h-8 w-8 text-primary" />
              </div>
            </div>
            <h1 className="text-2xl font-bold">Register Your Device</h1>
            <p className="text-sm text-muted-foreground">
              Create a passkey with your device&apos;s biometric (fingerprint or face) to securely mark attendance
            </p>
          </div>

          {status === "success" ? (
            <div className="space-y-6 text-center">
              <div className="space-y-2">
                <CheckCircle2 className="mx-auto h-16 w-16 text-green-600" />
                <p className="font-semibold text-green-700 text-lg">
                  Passkey Registered!
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your device is now secured and ready to use
                </p>
              </div>
              <button
                onClick={() => {
                  router.push(session?.user ? "/student" : "/login");
                }}
                className="w-full h-10 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-colors"
              >
                Continue to Dashboard
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <button
                onClick={handleRegister}
                disabled={
                  status === "loading" ||
                  checkingLock ||
                  passkeysLockedUntilAdminReset ||
                  hasExistingPasskey
                }
                className="w-full inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {checkingLock ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Checking status...
                  </>
                ) : status === "loading" ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Setting up...
                  </>
                ) : passkeysLockedUntilAdminReset ? (
                  <>
                    <AlertCircle className="h-5 w-5" />
                    Registration Locked
                  </>
                ) : hasExistingPasskey ? (
                  <>
                    <AlertCircle className="h-5 w-5" />
                    Delete Existing Passkey First
                  </>
                ) : (
                  <>
                    <Fingerprint className="h-5 w-5" />
                    Register Biometric
                  </>
                )}
              </button>

              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <p className="text-xs font-medium text-foreground">Why is this required?</p>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="font-bold">•</span>
                    <span>Only you can use this passkey with your biometric</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold">•</span>
                    <span>Prevents unauthorized attendance marking</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold">•</span>
                    <span>Cannot be shared or deleted without your permission</span>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
