interface ConfidenceInput {
  webauthnVerified: boolean;
  gpsWithinRadius: boolean;
  qrTokenValid: boolean;
  // New security factors
  gpsVelocityAnomaly?: boolean;
  deviceConsistency?: number; // 0-100
  bleProximityVerified?: boolean;
  bleSignalStrength?: number; // RSSI -100 to -20
  deviceMismatch?: boolean;
  locationJump?: boolean;
}

const WEIGHTS = {
  webauthn: 30,
  gps: 25,
  qr: 25,
  bleProximity: 20,
} as const;

const PENALTIES = {
  gpsVelocityAnomaly: -20,
  deviceMismatch: -15,
  locationJump: -25,
  bleSignalWeak: -10, // RSSI < -80
  lowDeviceConsistency: -15, // < 50%
} as const;

/**
 * Calculate attendance confidence score (0-100)
 * Now includes dynamic weighting based on behavioral anomalies
 */
export function calculateConfidence(input: ConfidenceInput): number {
  let score = 0;

  // Base layer scoring
  if (input.webauthnVerified) score += WEIGHTS.webauthn;
  if (input.gpsWithinRadius) score += WEIGHTS.gps;
  if (input.qrTokenValid) score += WEIGHTS.qr;
  if (input.bleProximityVerified) score += WEIGHTS.bleProximity;

  // Device consistency factor (additional bonus)
  if (input.deviceConsistency && input.deviceConsistency > 80) {
    score += 5; // Bonus for high device consistency
  }

  // Apply anomaly penalties
  if (input.gpsVelocityAnomaly) {
    score += PENALTIES.gpsVelocityAnomaly;
  }

  if (input.deviceMismatch) {
    score += PENALTIES.deviceMismatch;
  }

  if (input.locationJump) {
    score += PENALTIES.locationJump;
  }

  // BLE signal strength penalty
  if (
    input.bleSignalStrength !== undefined &&
    input.bleSignalStrength < -80 &&
    input.bleProximityVerified
  ) {
    score += PENALTIES.bleSignalWeak;
  }

  // Device consistency penalty
  if (input.deviceConsistency && input.deviceConsistency < 50) {
    score += PENALTIES.lowDeviceConsistency;
  }

  // Clamp score between 0 and 100
  return Math.max(0, Math.min(100, score));
}

/**
 * Determine if attendance should be flagged for review
 * Uses dynamic thresholds based on anomaly severity
 */
export function isFlagged(
  confidence: number,
  baseThreshold: number = 70,
  hasAnomalies: boolean = false
): boolean {
  // Lower threshold if anomalies detected (more scrutiny)
  const threshold = hasAnomalies ? Math.min(baseThreshold, 65) : baseThreshold;
  return confidence < threshold;
}

/**
 * Get detailed confidence breakdown for admin review
 */
export function getConfidenceBreakdown(input: ConfidenceInput) {
  return {
    layers: {
      webauthn: input.webauthnVerified ? WEIGHTS.webauthn : 0,
      gps: input.gpsWithinRadius ? WEIGHTS.gps : 0,
      qr: input.qrTokenValid ? WEIGHTS.qr : 0,
      ble: input.bleProximityVerified ? WEIGHTS.bleProximity : 0,
    },
    anomalies: {
      gpsVelocity: input.gpsVelocityAnomaly ? PENALTIES.gpsVelocityAnomaly : 0,
      deviceMismatch: input.deviceMismatch ? PENALTIES.deviceMismatch : 0,
      locationJump: input.locationJump ? PENALTIES.locationJump : 0,
      bleSignalWeak: input.bleSignalStrength && input.bleSignalStrength < -80 ? PENALTIES.bleSignalWeak : 0,
    },
    deviceConsistency: input.deviceConsistency ?? 0,
  };
}
