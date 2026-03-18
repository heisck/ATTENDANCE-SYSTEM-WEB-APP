import { describe, expect, it } from "vitest";

import { calculateConfidence, isFlagged } from "@/lib/confidence";

describe("confidence scoring", () => {
  it("penalizes weak QR-only browser marks on inconsistent devices", () => {
    expect(
      calculateConfidence({
        webauthnVerified: true,
        qrTokenValid: true,
        bleProximityVerified: false,
        deviceConsistency: 35,
        deviceMismatch: true,
      })
    ).toBeLessThan(55);
  });

  it("requires a stricter threshold when anomalies are present", () => {
    expect(isFlagged(75, 70, true)).toBe(true);
    expect(isFlagged(81, 70, true)).toBe(false);
  });
});
