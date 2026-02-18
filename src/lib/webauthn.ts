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

export async function getRegistrationOptions(userId: string, userName: string) {
  const existingCredentials = await db.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: userId,
    userName,
    attestationType: "none",
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.credentialId,
      type: "public-key",
      transports: cred.transports as AuthenticatorTransportFuture[],
    })) as any,
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

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (verification.verified && verification.registrationInfo) {
    const info = verification.registrationInfo;

    await db.webAuthnCredential.create({
      data: {
        userId,
        credentialId: Buffer.from(info.credentialID).toString("base64url"),
        publicKey: Buffer.from(info.credentialPublicKey),
        counter: BigInt(info.counter),
        transports: response.response?.transports || [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        userAgent,
      },
    });
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
    allowCredentials: credentials.map((cred) => ({
      id: cred.credentialId,
      type: "public-key",
      transports: cred.transports as AuthenticatorTransportFuture[],
    })) as any,
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

  if (!credential || credential.userId !== userId) {
    throw new Error("Credential not found or does not belong to user");
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: Buffer.from(credential.credentialId, "base64url"),
      credentialPublicKey: credential.publicKey,
      counter: Number(credential.counter),
      transports: credential.transports as AuthenticatorTransportFuture[],
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
