import { describe, expect, it } from "vitest";

import {
  generatePhaseBoundBleToken,
  generatePhaseBoundQrToken,
  verifyBleTokenStrict,
  verifyBleTokenForSequence,
  verifyQrTokenStrict,
  verifyQrTokenForSequence,
} from "@/lib/qr";

describe("qr token domains", () => {
  it("keeps QR and BLE tokens cryptographically distinct", () => {
    const secret = "test-secret";
    const phase = "PHASE_ONE" as const;
    const sequence = 12345;

    const qrToken = generatePhaseBoundQrToken(secret, phase, sequence);
    const bleToken = generatePhaseBoundBleToken(secret, phase, sequence);

    expect(qrToken).not.toEqual(bleToken);
    expect(verifyQrTokenForSequence(secret, qrToken, phase, sequence)).toBe(true);
    expect(verifyBleTokenForSequence(secret, bleToken, phase, sequence)).toBe(true);
    expect(verifyBleTokenForSequence(secret, qrToken, phase, sequence)).toBe(false);
    expect(verifyQrTokenForSequence(secret, bleToken, phase, sequence)).toBe(false);
    expect(verifyQrTokenStrict(secret, qrToken, phase, sequence * 5000, 5000, 1000)).toBe(true);
    expect(verifyBleTokenStrict(secret, bleToken, phase, sequence * 5000, 5000, 1000)).toBe(true);
    expect(verifyBleTokenStrict(secret, qrToken, phase, sequence * 5000, 5000, 1000)).toBe(false);
  });
});
