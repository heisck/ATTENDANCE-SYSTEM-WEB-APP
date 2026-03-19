"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { AuthPageLayout } from "@/components/auth/auth-page-layout";
import { FaceLivenessCapture } from "@/components/face-liveness-capture";

type EnrollmentSummary = {
  studentName: string;
  expiresAt: string;
  hasCompletedEnrollment: boolean;
  profileImageUrl: string | null;
  sameStudentSignedIn: boolean;
};

type LivenessSessionPayload = {
  sessionId: string;
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: string | null;
  };
};

export default function FaceEnrollPage() {
  return (
    <Suspense
      fallback={
        <AuthPageLayout pageLabel="Face Enrollment" contentMaxWidthClass="max-w-5xl">
          <div className="mx-auto flex w-full max-w-5xl flex-col justify-center">
            <div className="surface mx-auto w-full max-w-xl space-y-3 p-6 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Preparing face enrollment...
              </p>
            </div>
          </div>
        </AuthPageLayout>
      }
    >
      <FaceEnrollPageContent />
    </Suspense>
  );
}

function FaceEnrollPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [status, setStatus] = useState<"loading" | "ready" | "capturing" | "done" | "error">(
    "loading"
  );
  const [summary, setSummary] = useState<EnrollmentSummary | null>(null);
  const [capture, setCapture] = useState<LivenessSessionPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [continueUrl, setContinueUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const expiresLabel = useMemo(() => {
    if (!summary?.expiresAt) return null;
    return new Date(summary.expiresAt).toLocaleString();
  }, [summary?.expiresAt]);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("The face enrollment link is missing.");
      return;
    }

    async function validate() {
      try {
        const response = await fetch(
          `/api/face/enrollment/public?token=${encodeURIComponent(token)}`,
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || "Unable to validate this link.");
        }
        setSummary(data);
        setStatus("ready");
      } catch (error) {
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to validate this link."
        );
      }
    }

    void validate();
  }, [token]);

  async function handleStartCapture() {
    try {
      setErrorMessage("");
      const response = await fetch("/api/face/enrollment/public/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to start face capture.");
      }
      setCapture(data);
      setStatus("capturing");
    } catch (error) {
      setStatus("ready");
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to start face capture."
      );
    }
  }

  async function handleFinalize() {
    if (!capture) return;

    setSubmitting(true);
    try {
      const response = await fetch("/api/face/enrollment/public/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          livenessSessionId: capture.sessionId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Unable to finalize face enrollment.");
      }

      setContinueUrl(typeof data.continueUrl === "string" ? data.continueUrl : null);
      setStatus("done");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPageLayout pageLabel="Face Enrollment" contentMaxWidthClass="max-w-5xl">
      <div className="mx-auto flex w-full max-w-5xl flex-col justify-center">
        {status === "loading" ? (
          <div className="surface mx-auto w-full max-w-xl space-y-3 p-6 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Validating face enrollment link...</p>
          </div>
        ) : null}

        {status === "error" ? (
          <div className="surface mx-auto w-full max-w-xl space-y-4 p-6 text-center">
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">Face Enrollment Unavailable</h1>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              Back to Login
            </Link>
          </div>
        ) : null}

        {status === "ready" && summary ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <section className="surface space-y-5 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/40">
                  <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                </span>
                <div className="space-y-2">
                  <h1 className="text-xl font-semibold">Verify Your Face</h1>
                  <p className="text-sm text-muted-foreground">
                    This short liveness capture is required before passkey setup. The best
                    reference image becomes your initial profile photo.
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                <p className="text-sm font-medium">{summary.studentName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This link expires at {expiresLabel || "soon"}.
                </p>
                {summary.hasCompletedEnrollment ? (
                  <p className="mt-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    A face enrollment already exists for this account. Starting again will replace
                    the current profile photo and primary face reference for v1.
                  </p>
                ) : null}
              </div>

              {errorMessage ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleStartCapture}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Start Face Capture
              </button>
            </section>

            <aside className="surface-muted space-y-4 p-5 sm:p-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Tips
              </h2>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>Face the camera directly and keep your full face visible.</li>
                <li>Good lighting improves both liveness and face match accuracy.</li>
                <li>Finish this step before trying to register your passkey.</li>
              </ul>
            </aside>
          </div>
        ) : null}

        {status === "capturing" && capture ? (
          <FaceLivenessCapture
            sessionId={capture.sessionId}
            region={capture.region}
            credentials={capture.credentials}
            title="Face Enrollment Capture"
            description="Follow the camera guidance once, then wait while we finalize your enrollment."
            submitting={submitting}
            onComplete={handleFinalize}
            onCancel={() => {
              setCapture(null);
              setStatus("ready");
            }}
          />
        ) : null}

        {status === "done" ? (
          <div className="surface mx-auto w-full max-w-xl space-y-4 p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">Face Enrollment Complete</h1>
              <p className="text-sm text-muted-foreground">
                Your profile photo and primary enrollment reference image have been updated.
              </p>
            </div>
            {continueUrl ? (
              <button
                type="button"
                onClick={() => router.push(continueUrl)}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Continue
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
              >
                Sign In On Your Main Device
              </Link>
            )}
          </div>
        ) : null}
      </div>
    </AuthPageLayout>
  );
}
