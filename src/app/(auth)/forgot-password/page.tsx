"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Mail, Loader2 } from "lucide-react";
import { AuthPageLayout } from "@/components/auth/auth-page-layout";

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
    <AuthPageLayout pageLabel="Forgot Password" contentMaxWidthClass="max-w-xl">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-xl font-semibold tracking-tight">Forgot password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your account email to receive a reset link.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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

          <div className="group relative">
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@university.edu"
              className="flex h-11 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Reset Link"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Back to{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </AuthPageLayout>
  );
}
