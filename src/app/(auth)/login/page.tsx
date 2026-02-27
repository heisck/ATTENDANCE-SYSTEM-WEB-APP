"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { AuthPageLayout } from "@/components/auth/auth-page-layout";

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const error = searchParams.get("error");
    const registered = searchParams.get("registered");

    if (registered === "true") {
      toast.success("Account created successfully!", {
        description: "Sign in to continue.",
      });
      window.history.replaceState(null, "", "/login");
      return;
    }

    if (error === "CredentialsSignin" || error === "credentials") {
      toast.error("Invalid email or password. Please try again.");
      window.history.replaceState(null, "", "/login");
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const result = (await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
        callbackUrl: "/api/auth/signed-in-redirect",
      })) as { error?: string } | undefined;

      if (result?.error) {
        const message = "Invalid email or password";
        toast.error(message);
        return;
      }

      toast.success("Signed in successfully.", {
        description: "Redirecting to your dashboard.",
      });

      const redirectRes = await fetch("/api/auth/redirect-target", {
        method: "GET",
        cache: "no-store",
      });

      if (redirectRes.ok) {
        const data = (await redirectRes.json()) as { redirectTo?: string };
        router.replace(data.redirectTo || "/student");
        return;
      }

      router.replace("/api/auth/signed-in-redirect");
    } catch {
      const message = "Something went wrong. Please try again.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPageLayout
      pageLabel="Sign In"
      viewportMode="stable"
      contentMaxWidthClass="max-w-xl"
      headerLink={{ href: "/register", label: "Sign Up" }}
    >
      <div className="mx-auto flex h-full w-full max-w-md flex-col">
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/80"
        >
          <div className="shrink-0 border-b border-border/70 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
            <h1 className="text-[1.35rem] font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your credentials to access your account.
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  aria-label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  aria-label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  className="flex h-11 w-full rounded-xl border border-border/70 bg-muted/35 py-2 pl-10 pr-10 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

            <div className="flex justify-end">
              <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:px-6 sm:pb-4">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </div>
        </form>
      </div>
    </AuthPageLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthPageLayout
          pageLabel="Sign In"
          viewportMode="stable"
          contentMaxWidthClass="max-w-xl"
          headerLink={{ href: "/register", label: "Sign Up" }}
        >
          <div className="flex w-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </AuthPageLayout>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
