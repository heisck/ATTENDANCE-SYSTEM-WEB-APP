"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type StudentFaceEnrollmentPanelProps = {
  userName: string;
};

type EnrollmentLinkPayload = {
  url: string;
  expiresAt: string;
};

export function StudentFaceEnrollmentPanel({
  userName,
}: StudentFaceEnrollmentPanelProps) {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkPayload, setLinkPayload] = useState<EnrollmentLinkPayload | null>(null);

  const linkLabel = useMemo(() => {
    if (!linkPayload?.expiresAt) return null;
    return new Date(linkPayload.expiresAt).toLocaleTimeString();
  }, [linkPayload?.expiresAt]);

  async function createEnrollmentLink() {
    const response = await fetch("/api/face/enrollment/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Unable to prepare face enrollment.");
    }

    const payload = {
      url: data.url as string,
      expiresAt: data.expiresAt as string,
    };
    setLinkPayload(payload);
    return payload;
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

  async function handleRefreshLink() {
    setLinkLoading(true);
    try {
      await createEnrollmentLink();
      toast.success("Another-device link is ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the link.");
    } finally {
      setLinkLoading(false);
    }
  }

  async function handleCopyLink() {
    if (!linkPayload?.url) return;
    try {
      await navigator.clipboard.writeText(linkPayload.url);
      toast.success("Face enrollment link copied.");
    } catch {
      toast.error("Unable to copy the link on this device.");
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
              {userName}, face enrollment is now required before passkey registration. You can
              capture on this device or open a short-lived link on another device with a better
              camera.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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
                Start On This Device
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleRefreshLink}
            disabled={linkLoading}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {linkLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing Link...
              </>
            ) : (
              <>
                <ExternalLink className="h-4 w-4" />
                Use Another Device
              </>
            )}
          </button>
        </div>

        {linkPayload ? (
          <div className="space-y-3 rounded-2xl border border-border/70 bg-background/35 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Another-device link</p>
                <p className="text-xs text-muted-foreground">
                  Expires at {linkLabel || "soon"}.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Copy className="h-4 w-4" />
                Copy Link
              </button>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
              <span className="break-all">{linkPayload.url}</span>
            </div>
          </div>
        ) : null}
      </section>

      <aside className="surface-muted space-y-4 p-5 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Before You Start
        </h2>
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li>Use a well-lit camera and keep your whole face centered.</li>
          <li>The best frame from the liveness capture becomes your profile photo.</li>
          <li>Your passkey setup comes immediately after face enrollment is complete.</li>
        </ul>
        <button
          type="button"
          onClick={handleRefreshLink}
          disabled={linkLoading}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
        >
          {linkLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh Another-Device Link
        </button>
      </aside>
    </div>
  );
}
