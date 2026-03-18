import { describe, expect, it } from "vitest";
import { hash as bcryptHash } from "bcryptjs";
import argon2 from "argon2";
import { hashPassword, verifyPassword } from "@/lib/passwords";

describe("passwords", () => {
  it("hashes new passwords with argon2id and verifies them", async () => {
    const password = "S3cur3-P@ssw0rd!";
    const hash = await hashPassword(password);

    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(password, hash)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it("accepts legacy bcrypt hashes and marks them for upgrade", async () => {
    const password = "legacy-password";
    const legacyHash = await bcryptHash(password, 10);

    await expect(verifyPassword(password, legacyHash)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it("rejects incorrect passwords", async () => {
    const hash = await argon2.hash("correct-password");

    await expect(verifyPassword("wrong-password", hash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});
