import argon2 from "argon2";
import { compare as bcryptCompare } from "bcryptjs";

const ARGON2_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 4096,
  timeCost: 3,
  parallelism: 1,
} as const;

const BCRYPT_HASH_PATTERN = /^\$2[abyx]\$\d{2}\$/;

export type PasswordVerificationResult = {
  valid: boolean;
  needsRehash: boolean;
};

export function isLegacyBcryptHash(storedHash: string) {
  return BCRYPT_HASH_PATTERN.test(storedHash);
}

export function isArgon2Hash(storedHash: string) {
  return storedHash.startsWith("$argon2");
}

export async function hashPassword(password: string) {
  return argon2.hash(password, ARGON2_HASH_OPTIONS);
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<PasswordVerificationResult> {
  if (isArgon2Hash(storedHash)) {
    try {
      const valid = await argon2.verify(storedHash, password);
      return {
        valid,
        needsRehash:
          valid &&
          argon2.needsRehash(storedHash, {
            memoryCost: ARGON2_HASH_OPTIONS.memoryCost,
            timeCost: ARGON2_HASH_OPTIONS.timeCost,
            parallelism: ARGON2_HASH_OPTIONS.parallelism,
          }),
      };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  if (isLegacyBcryptHash(storedHash)) {
    try {
      const valid = await bcryptCompare(password, storedHash);
      return { valid, needsRehash: valid };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  return { valid: false, needsRehash: false };
}
