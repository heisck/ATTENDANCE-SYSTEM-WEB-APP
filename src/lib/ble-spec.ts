export type BleAttendancePhase = "PHASE_ONE" | "PHASE_TWO" | "CLOSED";

export const ATTENDANCE_BLE = {
  NAME_PREFIX: "ATD-",
  SERVICE_UUID: "b9f2c841-8e2f-4f96-9167-8fdf4564a001",
  CURRENT_TOKEN_CHAR_UUID: "b9f2c841-8e2f-4f96-9167-8fdf4564a002",
  SESSION_META_CHAR_UUID: "b9f2c841-8e2f-4f96-9167-8fdf4564a003",
  MANUFACTURER_COMPANY_ID: 0xffff,
  BROADCASTER_HEARTBEAT_TTL_SECONDS: 20,
} as const;

function sanitizeCourseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function fingerprintSessionId(sessionId: string): [number, number, number, number] {
  let a = 0x42;
  let b = 0x13;
  let c = 0xa7;
  let d = 0x5e;
  for (let i = 0; i < sessionId.length; i += 1) {
    const code = sessionId.charCodeAt(i) & 0xff;
    a = (a + code + i) & 0xff;
    b = (b ^ ((code << (i % 3)) & 0xff)) & 0xff;
    c = (c + ((code ^ a) & 0xff)) & 0xff;
    d = (d ^ ((code + b + c) & 0xff)) & 0xff;
  }
  return [a, b, c, d];
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

export function phaseToShortCode(phase: BleAttendancePhase): "P1" | "P2" | "PC" {
  if (phase === "PHASE_ONE") return "P1";
  if (phase === "PHASE_TWO") return "P2";
  return "PC";
}

export function phaseToNumericCode(phase: BleAttendancePhase): number {
  if (phase === "PHASE_ONE") return 0x01;
  if (phase === "PHASE_TWO") return 0x02;
  return 0x03;
}

export function buildAttendanceBeaconName(input: {
  courseCode: string;
  sessionId: string;
  phase: BleAttendancePhase;
}): string {
  const courseCode = sanitizeCourseCode(input.courseCode) || "COURSE";
  const phaseCode = phaseToShortCode(input.phase);
  const shortId = input.sessionId.slice(-4).toUpperCase();
  return `${ATTENDANCE_BLE.NAME_PREFIX}${courseCode}-${phaseCode}-${shortId}`;
}

export function buildAttendanceManufacturerDataHex(input: {
  courseCode: string;
  sessionId: string;
  phase: BleAttendancePhase;
}): string {
  const course = sanitizeCourseCode(input.courseCode).padEnd(4, "_").slice(0, 4);
  const [f0, f1, f2, f3] = fingerprintSessionId(input.sessionId);
  const bytes: number[] = [
    0x41, // A
    0x54, // T
    0x44, // D
    0x01, // version
    phaseToNumericCode(input.phase),
    course.charCodeAt(0),
    course.charCodeAt(1),
    course.charCodeAt(2),
    course.charCodeAt(3),
    f0,
    f1,
    f2,
    f3,
  ];
  return bytes.map(toHexByte).join("");
}

export type BleTokenPayload = {
  sessionId: string;
  phase: BleAttendancePhase;
  sequence: number;
  token: string;
  ts: number;
  tokenTimestamp: number;
  rotationMs: number;
  phaseEndsAt: string;
};

export type BleSessionMetaPayload = {
  sessionId: string;
  phase: BleAttendancePhase;
  rotationMs: number;
  phaseEndsAt: string;
  beaconName: string;
};
