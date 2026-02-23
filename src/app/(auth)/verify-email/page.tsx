"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export default function VerifyEmailPage() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Missing verification token.");
      return;
    }

    async function verify() {
      try {
        const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Verification failed");
        }
        setStatus("success");
      } catch (err: any) {
        setStatus("error");
        setError(err.message || "Verification failed");
      }
    }

    void verify();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center">
        {status === "loading" && (
          <div className="space-y-3">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <h1 className="text-xl font-semibold">Verifying email...</h1>
          </div>
        )}

        {status === "success" && (
          <div className="space-y-3">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <h1 className="text-xl font-semibold">Personal email verified</h1>
            <p className="text-sm text-muted-foreground">
              You can now sign in and continue attendance setup.
            </p>
            <Link href="/login" className="inline-flex text-sm font-medium text-primary hover:underline">
              Go to login
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="text-xl font-semibold">Verification failed</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Link href="/login" className="inline-flex text-sm font-medium text-primary hover:underline">
              Back to login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
