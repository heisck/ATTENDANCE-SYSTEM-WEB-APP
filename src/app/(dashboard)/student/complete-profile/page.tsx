"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, CheckCircle2, AlertTriangle } from "lucide-react";

type StudentProfileState = {
  email: string;
  personalEmail: string | null;
  personalEmailVerifiedAt: string | null;
};

export default function CompleteProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<StudentProfileState | null>(null);
  const [personalEmail, setPersonalEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canProceed, setCanProceed] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [profileRes, statusRes] = await Promise.all([
          fetch("/api/auth/student-profile"),
          fetch("/api/auth/student-status"),
        ]);

        if (!profileRes.ok) {
          throw new Error("Unable to load student profile");
        }
        const profileData = await profileRes.json();
        setProfile(profileData);
        setPersonalEmail(profileData.personalEmail || "");

        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setCanProceed(Boolean(statusData.canProceed));
        }
      } catch (err: any) {
        setError(err.message || "Unable to load profile");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/auth/student-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personalEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to save profile");
      }
      setMessage(data.message || "Profile updated.");
      setProfile((current) =>
        current
          ? {
              ...current,
              personalEmail,
              personalEmailVerifiedAt: null,
            }
          : current
      );
    } catch (err: any) {
      setError(err.message || "Unable to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to resend verification");
      setMessage("Verification link sent.");
    } catch (err: any) {
      setError(err.message || "Unable to resend verification");
    } finally {
      setResending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="surface p-6">
        <h1 className="text-2xl font-bold tracking-tight">Complete Student Profile</h1>
        <p className="mt-2 text-muted-foreground">
          Add and verify your personal email before attendance actions are enabled.
        </p>
      </div>

      {message && (
        <div className="status-panel flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="surface space-y-4 p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Institutional Email</p>
          <p className="font-medium">{profile?.email}</p>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <label htmlFor="personalEmail" className="text-sm font-medium">
            Personal Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="personalEmail"
              type="email"
              value={personalEmail}
              onChange={(e) => setPersonalEmail(e.target.value)}
              required
              placeholder="you@gmail.com"
              className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save and Send Verification"}
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || !profile?.personalEmail}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend Verification"}
            </button>
          </div>
        </form>
      </div>

      {profile?.personalEmailVerifiedAt ? (
        <div className="status-panel">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Personal email verified
          </div>
          <p className="mt-1 text-muted-foreground">You can continue to your dashboard.</p>
          <button
            type="button"
            onClick={() => router.push("/student")}
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Continue
          </button>
        </div>
      ) : (
        <div className="surface-muted p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Verification pending
          </div>
          <p className="mt-1 text-muted-foreground">
            Open your personal email inbox and click the verification link.
          </p>
        </div>
      )}

      {canProceed && (
        <div className="text-sm text-muted-foreground">
          Your account is fully ready. Continue to student dashboard.
        </div>
      )}
    </div>
  );
}
