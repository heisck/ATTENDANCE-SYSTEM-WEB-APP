"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

type StudentFaceEnrollmentPanelProps = {
  userName: string;
};

export function StudentFaceEnrollmentPanel({
  userName,
}: StudentFaceEnrollmentPanelProps) {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);

  async function createEnrollmentLink() {
    const response = await fetch("/api/face/enrollment/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Unable to prepare face enrollment.");
    }

    return {
      url: data.url as string,
      expiresAt: data.expiresAt as string,
    };
  }

  async function handleStartHere() {
    setLaunching(true);
    try {
      const payload = await createEnrollmentLink();
      router.push(payload.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open face enrollment.");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <section className="surface space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/40">
            <Camera className="h-5 w-5 text-muted-foreground" />
          </span>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Complete Face Enrollment</h1>
            <p className="text-sm text-muted-foreground">
              {userName}, record one short live face video before passkey setup. We use that
              capture to confirm liveness and save your best face frame as your profile photo.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleStartHere}
          disabled={launching}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {launching ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening...
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" />
              Start Face Capture
            </>
          )}
        </button>
      </section>

      <aside className="surface-muted space-y-4 p-5 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          How It Works
        </h2>
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li>After email verification, you record one short live face video.</li>
          <li>The best frame from that capture becomes your profile photo.</li>
          <li>Passkey setup comes only after face enrollment is complete.</li>
        </ul>
        <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/35">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </span>
            <div className="space-y-2">
              <p className="text-sm font-medium">Need a better camera?</p>
              <p className="text-sm text-muted-foreground">
                Sign in with this same student account on another phone, then open face
                enrollment there and complete the capture on that device. No copy-link step is
                required.
              </p>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
