import { describe, expect, it } from "vitest";

import {
  createBrowserDeviceProofToken,
  createBrowserFingerprintHash,
  verifyBrowserDeviceProofToken,
} from "@/lib/browser-device-proof";

function buildRequest(overrides?: {
  userAgent?: string;
  acceptLanguage?: string;
}) {
  return {
    headers: {
      get(name: string) {
        if (name === "user-agent") {
          return overrides?.userAgent ?? "Mozilla/5.0 Test Browser";
        }
        if (name === "accept-language") {
          return overrides?.acceptLanguage ?? "en-US,en;q=0.9";
        }
        return null;
      },
    },
  } as any;
}

describe("browser-device-proof", () => {
  it("creates a stable browser fingerprint hash from normalized browser signals", () => {
    const request = buildRequest();
    const rawFingerprint = JSON.stringify({
      platform: "Win32",
      language: "en-US",
      languages: ["en-US", "en"],
      timezone: "Africa/Accra",
      screen: "1920x1080x24",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      touchPoints: 0,
      vendor: "Google Inc.",
      cookieEnabled: true,
      colorScheme: "light",
    });

    expect(createBrowserFingerprintHash(request, rawFingerprint)).toBe(
      createBrowserFingerprintHash(request, rawFingerprint)
    );
  });

  it("rejects invalid browser fingerprint payloads", () => {
    const request = buildRequest();

    expect(createBrowserFingerprintHash(request, "not-json")).toBeNull();
    expect(createBrowserFingerprintHash(request, "")).toBeNull();
  });

  it("binds device proof tokens to user, device token, and fingerprint hash", () => {
    const nowMs = Date.UTC(2026, 2, 18, 10, 0, 0);
    const token = createBrowserDeviceProofToken(
      "student-1",
      "device-token-1",
      "fingerprint-hash-1",
      nowMs
    );

    expect(
      verifyBrowserDeviceProofToken(token, {
        userId: "student-1",
        deviceToken: "device-token-1",
        fingerprintHash: "fingerprint-hash-1",
        nowMs,
      })
    ).toBe(true);

    expect(
      verifyBrowserDeviceProofToken(token, {
        userId: "student-1",
        deviceToken: "device-token-2",
        fingerprintHash: "fingerprint-hash-1",
        nowMs,
      })
    ).toBe(false);

    expect(
      verifyBrowserDeviceProofToken(token, {
        userId: "student-1",
        deviceToken: "device-token-1",
        fingerprintHash: "fingerprint-hash-2",
        nowMs,
      })
    ).toBe(false);
  });
});
