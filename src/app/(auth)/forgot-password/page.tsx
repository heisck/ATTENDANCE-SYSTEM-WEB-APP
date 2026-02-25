"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail, Loader2 } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to request password reset");
      }
      setMessage(data.message || "If the email exists, a reset link has been sent.");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-6">
        <div className="text-center">
          <Image src="/web-app-manifest-192x192.png" alt="App logo" width={40} height={40} className="mx-auto rounded logo-mark" />
          <h1 className="mt-3 text-2xl font-bold">Forgot password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your account email to receive a reset link.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {message && (
            <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@university.edu"
                className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Reset Link"}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Back to{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
