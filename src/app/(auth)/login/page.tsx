"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { toast } from "sonner";
import Image from "next/image";
import { Loader2, Mail, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const error = searchParams.get("error");
    const registered = searchParams.get("registered");

    if (registered === "true") {
      toast.success("Account created successfully!", {
        description: "Sign in to continue.",
      });
      return;
    }

    if (error === "CredentialsSignin" || error === "credentials") {
      const message = "Invalid email or password. Please try again.";
      setServerError(message);
      toast.error(message);
      router.replace("/login", { scroll: false });
    }
  }, [searchParams, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    setLoading(true);

    try {
      const result = (await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: true,
        callbackUrl: "/api/auth/signed-in-redirect",
      })) as { error?: string } | undefined;

      if (result?.error) {
        const message = "Invalid email or password";
        setServerError(message);
        toast.error(message);
      }
      // With redirect: true, signIn navigates away on success; we only reach here on error
    } catch {
      const message = "Something went wrong. Please try again.";
      setServerError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-muted/50 via-background to-primary/5">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-[400px]">
        <div className="rounded-2xl border border-border/60 bg-card/95 shadow-xl shadow-black/5 backdrop-blur-sm p-8 space-y-8">
          <div className="text-center space-y-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary transition-colors hover:bg-primary/20 overflow-hidden"
            >
              <Image src="/web-app-manifest-192x192.png" alt="attendanceIQ" width={32} height={32} className="rounded-lg" />
            </Link>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in to your AttendanceIQ account
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {serverError && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/20">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                </div>
                <p className="text-sm text-destructive font-medium">{serverError}</p>
              </div>
            )}

            <div className="space-y-4">
              <div className="group relative">
                <label htmlFor="email" className="sr-only">Email</label>
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <input
                  id="email"
                  type="email"
                  aria-label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className="flex h-12 w-full rounded-xl border border-input bg-background/80 pl-12 pr-4 py-3 text-base placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
                />
              </div>

              <div className="group relative">
                <label htmlFor="password" className="sr-only">Password</label>
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <input
                  id="password"
                  aria-label="Password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  className="flex h-12 w-full rounded-xl border border-input bg-background/80 pl-12 pr-12 py-3 text-base placeholder:text-muted-foreground/80 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <div className="flex justify-end -mt-1">
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary hover:underline font-medium"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 hover:shadow-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="font-semibold text-primary hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-muted/50 via-background to-primary/5">
        <div className="w-full max-w-[400px]">
          <div className="rounded-2xl border border-border/60 bg-card/95 shadow-xl shadow-black/5 backdrop-blur-sm p-8 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
