interface ConfidenceInput {
  webauthnVerified: boolean;
  gpsWithinRadius: boolean;
  qrTokenValid: boolean;
  ipTrusted: boolean;
}

const WEIGHTS = {
  webauthn: 40,
  gps: 30,
  qr: 20,
  ip: 10,
} as const;

export function calculateConfidence(input: ConfidenceInput): number {
  let score = 0;
  if (input.webauthnVerified) score += WEIGHTS.webauthn;
  if (input.gpsWithinRadius) score += WEIGHTS.gps;
  if (input.qrTokenValid) score += WEIGHTS.qr;
  if (input.ipTrusted) score += WEIGHTS.ip;
  return score;
}

export function isFlagged(confidence: number, threshold: number = 70): boolean {
  return confidence < threshold;
}
