import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import { db } from "./db";

type AuthenticatorTransportFuture = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";

const rpName = process.env.WEBAUTHN_RP_NAME || "AttendanceIQ";
const rpID = process.env.WEBAUTHN_RP_ID || (process.env.NODE_ENV === "production" ? null : "localhost");
const origin = process.env.WEBAUTHN_ORIGIN || (process.env.NODE_ENV === "production" ? null : "http://localhost:3000");

// Validate critical WebAuthn config in production
if (process.env.NODE_ENV === "production") {
  if (!rpID || !origin) {
    throw new Error("WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN are required in production");
  }
}

const CHALLENGE_TTL_MS = 60000; // 60 seconds

function toBase64UrlCredentialId(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64url");
  if (Buffer.isBuffer(value)) return value.toString("base64url");
  return Buffer.from(value as ArrayBuffer).toString("base64url");
}

function maybeDecodeDoubleEncodedCredentialId(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (/^[A-Za-z0-9_-]{16,}$/.test(decoded) && decoded !== value) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getRegistrationOptions(userId: string, userName: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      personalEmail: true,
      personalEmailVerifiedAt: true,
      passkeysLockedUntilAdminReset: true,
    },
  });

  if (!user) throw new Error("User not found");

  if (user.passkeysLockedUntilAdminReset) {
    throw new Error("Passkey registration is locked. Please contact your administrator to reset.");
  }

  if (user.role === "STUDENT" && (!user.personalEmail || !user.personalEmailVerifiedAt)) {
    throw new Error("Verify your personal email before registering a passkey.");
  }

  const existingCredentials = await db.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  if (existingCredentials.length > 0) {
    throw new Error("Delete your existing passkey before registering a new one.");
  }

  const excludeCredentials = existingCredentials.flatMap((cred) => {
    const ids = [cred.credentialId];
    const decoded = maybeDecodeDoubleEncodedCredentialId(cred.credentialId);
    if (decoded) ids.push(decoded);

    return ids.map((id) => ({
      id,
      type: "public-key" as const,
      transports: cred.transports as AuthenticatorTransportFuture[],
    }));
  });

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpID!,
    userID: userId,
    userName,
    attestationType: "none",
    excludeCredentials: excludeCredentials as any,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
  });

  // Store challenge in database with TTL
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.webAuthnChallenge.deleteMany({ where: { userId } });
  await db.webAuthnChallenge.create({
    data: {
      userId,
      challenge: options.challenge,
      expiresAt,
    },
  });

  return options;
}

export async function verifyRegistration(
  userId: string,
  response: any,
  userAgent?: string
): Promise<VerifiedRegistrationResponse> {
  const challengeRecord = await db.webAuthnChallenge.findFirst({
    where: {
      userId,
      expiresAt: { gt: new Date() },
    },
  });
  if (!challengeRecord) {
    throw new Error("WebAuthn challenge invalid or expired");
  }
  const expectedChallenge = challengeRecord.challenge;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      personalEmail: true,
      personalEmailVerifiedAt: true,
      firstPasskeyCreatedAt: true,
      passkeysLockedUntilAdminReset: true,
    },
  });
  if (!user) throw new Error("User not found");

  // Check if passkeys are locked
  if (user.passkeysLockedUntilAdminReset) {
    throw new Error("Passkey registration is locked. Please contact your administrator to reset.");
  }

  if (user.role === "STUDENT" && (!user.personalEmail || !user.personalEmailVerifiedAt)) {
    throw new Error("Verify your personal email before registering a passkey.");
  }

  const existingCredentialCount = await db.webAuthnCredential.count({
    where: { userId },
  });

  if (existingCredentialCount > 0) {
    throw new Error("Delete your existing passkey before registering a new one.");
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin!,
    expectedRPID: rpID!,
  });

  if (verification.verified && verification.registrationInfo) {
    const info = verification.registrationInfo;
    await db.$transaction(async (tx) => {
      const freshUser = await tx.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          personalEmail: true,
          personalEmailVerifiedAt: true,
          firstPasskeyCreatedAt: true,
          passkeysLockedUntilAdminReset: true,
        },
      });

      if (!freshUser) {
        throw new Error("User not found");
      }

      if (freshUser.passkeysLockedUntilAdminReset) {
        throw new Error("Passkey registration is locked. Please contact your administrator to reset.");
      }

      if (
        freshUser.role === "STUDENT" &&
        (!freshUser.personalEmail || !freshUser.personalEmailVerifiedAt)
      ) {
        throw new Error("Verify your personal email before registering a passkey.");
      }

      const freshCredentialCount = await tx.webAuthnCredential.count({
        where: { userId },
      });

      if (freshCredentialCount > 0) {
        throw new Error("Delete your existing passkey before registering a new one.");
      }

      await tx.webAuthnCredential.create({
        data: {
          userId,
          credentialId: toBase64UrlCredentialId(info.credentialID),
          publicKey: Buffer.from(info.credentialPublicKey),
          counter: BigInt(info.counter),
          transports: response.response?.transports || [],
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          userAgent,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          passkeysLockedUntilAdminReset: true,
          firstPasskeyCreatedAt: freshUser.firstPasskeyCreatedAt ?? new Date(),
        },
      });
    });
  }

  // Clean up challenge after verification attempt
  await db.webAuthnChallenge.deleteMany({ where: { userId } });
  return verification;
}

export async function getAuthenticationOptions(userId: string) {
  const credentials = await db.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  if (credentials.length === 0) {
    throw new Error("No credentials registered for this user");
  }

  const options = await generateAuthenticationOptions({
    rpID: rpID!,
    // Let the client use discoverable credentials for this RP.
    // We still enforce account ownership server-side in verifyAuthentication().
    userVerification: "preferred",
  });

  // Store challenge in database with TTL
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.webAuthnChallenge.deleteMany({ where: { userId } });
  await db.webAuthnChallenge.create({
    data: {
      userId,
      challenge: options.challenge,
      expiresAt,
    },
  });

  return options;
}

export async function verifyAuthentication(
  userId: string,
  response: any
): Promise<VerifiedAuthenticationResponse> {
  const challengeRecord = await db.webAuthnChallenge.findFirst({
    where: {
      userId,
      expiresAt: { gt: new Date() },
    },
  });
  if (!challengeRecord) {
    throw new Error("WebAuthn challenge invalid or expired");
  }
  const expectedChallenge = challengeRecord.challenge;

  const credential = await db.webAuthnCredential.findUnique({
    where: { credentialId: response.id },
  });
  let resolvedCredential = credential;

  if (!resolvedCredential) {
    const legacyCredentialId = Buffer.from(response.id).toString("base64url");
    resolvedCredential = await db.webAuthnCredential.findUnique({
      where: { credentialId: legacyCredentialId },
    });

    // Self-heal legacy/double-encoded IDs when possible.
    if (resolvedCredential && resolvedCredential.userId === userId) {
      try {
        await db.webAuthnCredential.update({
          where: { id: resolvedCredential.id },
          data: { credentialId: response.id },
        });
        resolvedCredential = { ...resolvedCredential, credentialId: response.id };
      } catch (error: unknown) {
        // Log credential ID migration conflicts for monitoring
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("Unique constraint")) {
          console.warn("WebAuthn credential ID migration skipped - unique constraint", {
            userId,
            credentialId: resolvedCredential.id,
            reason: "Another credential may have this ID already",
          });
        } else {
          console.error("WebAuthn credential ID migration failed", {
            userId,
            credentialId: resolvedCredential.id,
            error: errorMessage,
          });
        }
        // Verification can continue despite migration failure
      }
    }
  }

  if (!resolvedCredential || resolvedCredential.userId !== userId) {
    throw new Error("Credential not found or does not belong to user");
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin!,
    expectedRPID: rpID!,
    authenticator: {
      credentialID: resolvedCredential.credentialId,
      credentialPublicKey: resolvedCredential.publicKey,
      counter: Number(resolvedCredential.counter),
      transports: resolvedCredential.transports as AuthenticatorTransportFuture[],
    },
  } as any);

  if (verification.verified) {
    await db.webAuthnCredential.update({
      where: { credentialId: response.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter) },
    });
  }

  // Clean up challenge after verification attempt
  await db.webAuthnChallenge.deleteMany({ where: { userId } });
  return verification;
}

export async function hasCredential(userId: string): Promise<boolean> {
  const count = await db.webAuthnCredential.count({ where: { userId } });
  return count > 0;
}
