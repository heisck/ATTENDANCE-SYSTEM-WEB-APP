"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Shield,
  Loader2,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  BadgeCheck,
  GraduationCap,
} from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    institutionalEmail: "",
    personalEmail: "",
    password: "",
    studentId: "",
    indexNumber: "",
    organizationSlug: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitStage, setSubmitStage] = useState<"creating" | "signing-in" | null>(null);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function resolveRedirectTarget(): Promise<string | null> {
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch("/api/auth/redirect-target", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        });

        if (res.ok) {
          const data = await res.json();
          if (
            typeof data.redirectTo === "string" &&
            data.redirectTo.startsWith("/")
          ) {
            return data.redirectTo;
          }
        }
      } catch {
        // Retry below
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 150 * (attempt + 1))
      );
    }

    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    setLoading(true);
    setSubmitStage("creating");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = data?.error || "Sign up failed. Please try again.";
        setServerError(message);
        toast.error(message);
        return;
      }

      toast.success("Account created successfully!", {
        description: `Welcome, ${data?.name || form.name || "student"}!`,
      });
      setSubmitStage("signing-in");

      const signInResult = await signIn("credentials", {
        email: form.institutionalEmail.trim().toLowerCase(),
        password: form.password,
        redirect: false,
        callbackUrl: "/",
      });

      if (signInResult?.error) {
        const message = "Account created, but automatic sign-in failed. Please sign in manually.";
        setServerError(message);
        toast.error(message);
        router.push("/login?registered=true");
        return;
      }

      toast.success("Sign in successful", {
        description: "Redirecting to your dashboard...",
      });
      const redirectTo = await resolveRedirectTarget();
      if (!redirectTo) {
        const message =
          "Signed in, but session redirect could not be resolved. Check AUTH_SECRET and AUTH_URL in production.";
        setServerError(message);
        toast.error(message);
        return;
      }

      window.location.assign(redirectTo);
    } catch {
      const message = "Something went wrong. Please try again.";
      setServerError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setSubmitStage(null);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <Shield className="h-10 w-10 text-primary" />
          </Link>
          <h1 className="mt-4 text-2xl font-bold">Create student account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Register with institutional + personal email
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {serverError && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm text-red-700">{serverError}</p>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Full Name
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="John Doe"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="institutionalEmail" className="text-sm font-medium">
              Institutional Email
            </label>
            <div className="relative">
              <GraduationCap className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="institutionalEmail"
                type="email"
                value={form.institutionalEmail}
                onChange={(e) => update("institutionalEmail", e.target.value)}
                placeholder="yourname@st.knust.edu.gh"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Must end with @st.knust.edu.gh
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="personalEmail" className="text-sm font-medium">
              Personal Email (for verification/reset)
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="personalEmail"
                type="email"
                value={form.personalEmail}
                onChange={(e) => update("personalEmail", e.target.value)}
                placeholder="you@gmail.com"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                placeholder="Min 8 characters"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-10 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="studentId" className="text-sm font-medium">
                Student ID
              </label>
              <div className="relative">
                <BadgeCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="studentId"
                  value={form.studentId}
                  onChange={(e) => update("studentId", e.target.value)}
                  placeholder="e.g. 20241234"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="indexNumber" className="text-sm font-medium">
                Index Number
              </label>
              <div className="relative">
                <BadgeCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="indexNumber"
                  value={form.indexNumber}
                  onChange={(e) => update("indexNumber", e.target.value)}
                  placeholder="e.g. ITC/24/0012"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="org" className="text-sm font-medium">
              University Code
            </label>
            <div className="relative">
              <Shield className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="org"
                value={form.organizationSlug}
                onChange={(e) => update("organizationSlug", e.target.value)}
                placeholder="e.g. knust"
                required
                className="flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Lecturer accounts are invite-only and managed by admins.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {submitStage === "signing-in" ? "Signing you in..." : "Creating account..."}
              </span>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline font-medium">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
