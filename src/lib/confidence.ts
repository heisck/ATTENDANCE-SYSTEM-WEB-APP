interface ConfidenceInput {
  webauthnVerified: boolean;
  qrTokenValid?: boolean | null;
  bleProximityVerified?: boolean | null;
  bleSignalStrength?: number | null; // RSSI -100 to -20
  deviceConsistency?: number; // 0-100
  deviceMismatch?: boolean;
}

const WEIGHTS = {
  webauthn: 45,
  qr: 20,
  bleProximity: 35,
} as const;

const PENALTIES = {
  deviceMismatch: -20,
  bleSignalWeak: -12, // RSSI < -80
  veryWeakBleSignal: -20, // RSSI < -90
  mediumDeviceConsistency: -10, // < 70%
  lowDeviceConsistency: -20, // < 50%
  veryLowDeviceConsistency: -30, // < 35%
  qrOnlySuspicion: -10,
} as const;

const BONUSES = {
  familiarDevice: 5,
  strongBleSignal: 5,
} as const;

export function calculateConfidence(input: ConfidenceInput): number {
  let score = 0;

  if (input.webauthnVerified) {
    score += WEIGHTS.webauthn;
  }
  if (input.qrTokenValid === true) {
    score += WEIGHTS.qr;
  }
  if (input.bleProximityVerified === true) {
    score += WEIGHTS.bleProximity;
  }

  if (input.deviceConsistency !== undefined && input.deviceConsistency >= 95) {
    score += BONUSES.familiarDevice;
  }
  if (input.deviceMismatch) {
    score += PENALTIES.deviceMismatch;
  }
  if (
    input.bleSignalStrength !== undefined &&
    input.bleSignalStrength !== null &&
    input.bleProximityVerified
  ) {
    if (input.bleSignalStrength < -90) {
      score += PENALTIES.veryWeakBleSignal;
    } else if (input.bleSignalStrength < -80) {
      score += PENALTIES.bleSignalWeak;
    } else if (input.bleSignalStrength >= -65) {
      score += BONUSES.strongBleSignal;
    }
  }

  if (input.deviceConsistency !== undefined) {
    if (input.deviceConsistency < 35) {
      score += PENALTIES.veryLowDeviceConsistency;
    } else if (input.deviceConsistency < 50) {
      score += PENALTIES.lowDeviceConsistency;
    } else if (input.deviceConsistency < 70) {
      score += PENALTIES.mediumDeviceConsistency;
    }
  }

  if (
    input.qrTokenValid === true &&
    input.bleProximityVerified !== true &&
    input.deviceConsistency !== undefined &&
    input.deviceConsistency < 60
  ) {
    score += PENALTIES.qrOnlySuspicion;
  }

  return Math.max(0, Math.min(100, score));
}

export function isFlagged(
  confidence: number,
  baseThreshold: number = 70,
  hasAnomalies: boolean = false
): boolean {
  const threshold = hasAnomalies
    ? Math.min(100, Math.max(baseThreshold, 80))
    : baseThreshold;
  return confidence < threshold;
}

export function getConfidenceBreakdown(input: ConfidenceInput) {
  const hasBleSignal =
    input.bleProximityVerified &&
    input.bleSignalStrength !== undefined &&
    input.bleSignalStrength !== null;
  const bleSignalStrength =
    hasBleSignal && typeof input.bleSignalStrength === "number"
      ? input.bleSignalStrength
      : null;

  return {
    layers: {
      webauthn: input.webauthnVerified ? WEIGHTS.webauthn : 0,
      qr: input.qrTokenValid ? WEIGHTS.qr : 0,
      ble: input.bleProximityVerified ? WEIGHTS.bleProximity : 0,
    },
    anomalies: {
      deviceMismatch: input.deviceMismatch ? PENALTIES.deviceMismatch : 0,
      bleSignalWeak: bleSignalStrength !== null
        ? bleSignalStrength < -90
          ? PENALTIES.veryWeakBleSignal
          : bleSignalStrength < -80
            ? PENALTIES.bleSignalWeak
            : 0
        : 0,
    },
    deviceConsistency: input.deviceConsistency ?? 0,
  };
}
