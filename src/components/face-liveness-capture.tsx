"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Camera, Loader2 } from "lucide-react";
import "@aws-amplify/ui-react-liveness/styles.css";
import type { AwsCredentials } from "@aws-amplify/ui-react-liveness";
import { toast } from "sonner";

const FaceLivenessDetectorCore = dynamic(
  () =>
    import("@aws-amplify/ui-react-liveness").then((mod) => mod.FaceLivenessDetectorCore),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[18rem] items-center justify-center rounded-2xl border border-border/70 bg-background/40">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    ),
  }
);

type FaceLivenessCaptureProps = {
  sessionId: string;
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: string | null;
  };
  title: string;
  description: string;
  submitting?: boolean;
  onComplete: () => Promise<void>;
  onCancel?: () => void;
  onFailure?: (message: string) => void;
};

export function FaceLivenessCapture({
  sessionId,
  region,
  credentials,
  title,
  description,
  submitting = false,
  onComplete,
  onCancel,
  onFailure,
}: FaceLivenessCaptureProps) {
  const provider = useMemo(
    () => async (): Promise<AwsCredentials> => ({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      expiration: credentials.expiration ? new Date(credentials.expiration) : undefined,
    }),
    [
      credentials.accessKeyId,
      credentials.expiration,
      credentials.secretAccessKey,
      credentials.sessionToken,
    ]
  );

  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-background/40 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-muted/35">
          <Camera className="h-5 w-5 text-muted-foreground" />
        </span>
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-black/20">
        <FaceLivenessDetectorCore
          sessionId={sessionId}
          region={region}
          onAnalysisComplete={async () => {
            try {
              await onComplete();
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Face verification could not be completed.";
              onFailure?.(message);
              toast.error(message);
            }
          }}
          onUserCancel={onCancel}
          onError={(livenessError) => {
            const message =
              livenessError.error?.message ||
              "Face capture could not be started. Please try again.";
            onFailure?.(message);
            toast.error(message);
          }}
          config={{
            credentialProvider: provider,
          }}
        />
      </div>

      {submitting ? (
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Finalizing face verification...
        </div>
      ) : null}
    </div>
  );
}
