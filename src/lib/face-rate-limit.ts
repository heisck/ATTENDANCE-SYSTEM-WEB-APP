import { createHash } from "crypto";
import { checkRateLimitKey } from "@/lib/cache";

function hashIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function checkFaceRateLimit(input: {
  scope: string;
  identifier: string;
  maxAttempts: number;
  windowSeconds: number;
}) {
  return checkRateLimitKey(
    `ratelimit:face:${input.scope}:${hashIdentifier(input.identifier)}`,
    input.maxAttempts,
    input.windowSeconds
  );
}

export function buildFaceRateLimitMessage(action: string, windowSeconds: number) {
  if (windowSeconds < 60) {
    return `Too many ${action} attempts. Wait ${windowSeconds} seconds before retrying.`;
  }

  const minutes = Math.ceil(windowSeconds / 60);
  return `Too many ${action} attempts. Wait ${minutes} minute${minutes === 1 ? "" : "s"} before retrying.`;
}
