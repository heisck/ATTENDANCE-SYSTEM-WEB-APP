"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Loader2, Mail, Lock, Eye, EyeOff, User } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

type InviteMeta = {
  invitedEmail: string;
  expiresAt: string;
  organization: { id: string; name: string; slug: string };
};

export default function AcceptInvitePage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState<InviteMeta | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);

  useEffect(() => {
    if (!token) return;

    async function loadInvite() {
      try {
        const res = await fetch(`/api/auth/invite/validate?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invite is invalid");
        setInvite(data);
      } catch (err: any) {
        setError(err.message || "Invite is invalid");
      } finally {
        setLoadingInvite(false);
      }
    }

    void loadInvite();
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoadingInvite(false);
      setError("Invite token is missing.");
    }
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite) return;

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to accept invite");
      router.push("/login?invited=true");
    } catch (err: any) {
      setError(err.message || "Unable to accept invite");
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
          <Image src="/web-app-manifest-192x192.png" alt="attendanceIQ" width={40} height={40} className="mx-auto rounded logo-mark" />
          <h1 className="mt-3 text-2xl font-bold">Accept Lecturer Invite</h1>
        </div>

        {loadingInvite ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !invite ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-destructive">{error || "Invite is invalid or expired."}</p>
            <Link href="/login" className="text-sm font-medium text-primary hover:underline">
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{invite.organization.name}</p>
              <p className="text-muted-foreground">{invite.invitedEmail}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Full Name
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Lecturer Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  value={invite.invitedEmail}
                  disabled
                  className="flex h-10 w-full rounded-md border border-input bg-muted pl-10 pr-3 py-2 text-muted-foreground"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-10 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Lecturer Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
