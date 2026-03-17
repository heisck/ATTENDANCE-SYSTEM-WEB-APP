import { describe, expect, it } from "vitest";
import {
  createAttendanceProofToken,
  verifyAttendanceProofToken,
} from "@/lib/attendance-proof";

describe("attendance-proof", () => {
  it("verifies a freshly issued proof token for the same user", () => {
    const now = Date.UTC(2026, 2, 17, 10, 0, 0);
    const token = createAttendanceProofToken("student-1", now);

    expect(verifyAttendanceProofToken(token, "student-1", now + 1_000)).toBe(true);
  });

  it("rejects proof tokens for a different user or after expiry", () => {
    const now = Date.UTC(2026, 2, 17, 10, 0, 0);
    const token = createAttendanceProofToken("student-1", now);

    expect(verifyAttendanceProofToken(token, "student-2", now + 1_000)).toBe(false);
    expect(verifyAttendanceProofToken(token, "student-1", now + 10 * 60 * 1000 + 1)).toBe(
      false
    );
  });
});
