interface ConfidenceInput {
  webauthnVerified: boolean;
  qrTokenValid?: boolean | null;
  bleProximityVerified?: boolean | null;
  bleSignalStrength?: number | null; // RSSI -100 to -20
  deviceConsistency?: number; // 0-100
  deviceMismatch?: boolean;
}

const WEIGHTS = {
  webauthn: 50,
  qr: 30,
  bleProximity: 20,
} as const;

const PENALTIES = {
  deviceMismatch: -15,
  bleSignalWeak: -10, // RSSI < -80
  lowDeviceConsistency: -15, // < 50%
} as const;

export function calculateConfidence(input: ConfidenceInput): number {
  const layers = [
    { weight: WEIGHTS.webauthn, value: input.webauthnVerified },
    { weight: WEIGHTS.qr, value: input.qrTokenValid },
    { weight: WEIGHTS.bleProximity, value: input.bleProximityVerified },
  ] as const;

  let earnedBaseScore = 0;
  let maxBaseScore = 0;
  for (const layer of layers) {
    if (layer.value === null || layer.value === undefined) {
      continue;
    }
    maxBaseScore += layer.weight;
    if (layer.value) {
      earnedBaseScore += layer.weight;
    }
  }

  let score = maxBaseScore > 0 ? (earnedBaseScore / maxBaseScore) * 100 : 0;

  if (input.deviceConsistency !== undefined && input.deviceConsistency > 80) {
    score += 5;
  }
  if (input.deviceMismatch) {
    score += PENALTIES.deviceMismatch;
  }
  if (
    input.bleSignalStrength !== undefined &&
    input.bleSignalStrength !== null &&
    input.bleSignalStrength < -80 &&
    input.bleProximityVerified
  ) {
    score += PENALTIES.bleSignalWeak;
  }
  if (input.deviceConsistency !== undefined && input.deviceConsistency < 50) {
    score += PENALTIES.lowDeviceConsistency;
  }

  return Math.max(0, Math.min(100, score));
}

export function isFlagged(
  confidence: number,
  baseThreshold: number = 70,
  hasAnomalies: boolean = false
): boolean {
  const threshold = hasAnomalies ? Math.min(baseThreshold, 65) : baseThreshold;
  return confidence < threshold;
}

export function getConfidenceBreakdown(input: ConfidenceInput) {
  return {
    layers: {
      webauthn: input.webauthnVerified ? WEIGHTS.webauthn : 0,
      qr: input.qrTokenValid ? WEIGHTS.qr : 0,
      ble: input.bleProximityVerified ? WEIGHTS.bleProximity : 0,
    },
    anomalies: {
      deviceMismatch: input.deviceMismatch ? PENALTIES.deviceMismatch : 0,
      bleSignalWeak:
        input.bleProximityVerified &&
        input.bleSignalStrength !== undefined &&
        input.bleSignalStrength !== null &&
        input.bleSignalStrength < -80
          ? PENALTIES.bleSignalWeak
          : 0,
    },
    deviceConsistency: input.deviceConsistency ?? 0,
  };
}
