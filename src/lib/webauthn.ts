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
const rpID = process.env.WEBAUTHN_RP_ID || "localhost";
const origin = process.env.WEBAUTHN_ORIGIN || "http://localhost:3000";

const challengeStore = new Map<string, string>();

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
  const existingCredentials = await db.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

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
    rpID,
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

  challengeStore.set(userId, options.challenge);
  setTimeout(() => challengeStore.delete(userId), 60000);

  return options;
}

export async function verifyRegistration(
  userId: string,
  response: any,
  userAgent?: string
): Promise<VerifiedRegistrationResponse> {
  const expectedChallenge = challengeStore.get(userId);
  if (!expectedChallenge) throw new Error("Challenge expired or not found");

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  // Check if passkeys are locked
  if (user.passkeysLockedUntilAdminReset && user.firstPasskeyCreatedAt) {
    throw new Error("Passkey registration is locked. Please contact your administrator to reset.");
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (verification.verified && verification.registrationInfo) {
    const info = verification.registrationInfo;

    // Lock passkeys after first creation
    await db.webAuthnCredential.create({
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

    // Mark passkeys as locked on first creation
    if (!user.firstPasskeyCreatedAt) {
      await db.user.update({
        where: { id: userId },
        data: {
          firstPasskeyCreatedAt: new Date(),
          passkeysLockedUntilAdminReset: true,
        },
      });
    }
  }

  challengeStore.delete(userId);
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
    rpID,
    // Let the client use discoverable credentials for this RP.
    // We still enforce account ownership server-side in verifyAuthentication().
    userVerification: "preferred",
  });

  challengeStore.set(userId, options.challenge);
  setTimeout(() => challengeStore.delete(userId), 60000);

  return options;
}

export async function verifyAuthentication(
  userId: string,
  response: any
): Promise<VerifiedAuthenticationResponse> {
  const expectedChallenge = challengeStore.get(userId);
  if (!expectedChallenge) throw new Error("Challenge expired or not found");

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
      } catch {
        // Ignore if unique conflict; verification can still continue.
      }
    }
  }

  if (!resolvedCredential || resolvedCredential.userId !== userId) {
    throw new Error("Credential not found or does not belong to user");
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
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

  challengeStore.delete(userId);
  return verification;
}

export async function hasCredential(userId: string): Promise<boolean> {
  const count = await db.webAuthnCredential.count({ where: { userId } });
  return count > 0;
}
