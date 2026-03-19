export const SESSION_FLOW_VALUES = [
  "NEW_SESSION",
  "PHASE_ONE_FOLLOW_UP",
  "PHASE_TWO_CLOSING",
  "PHASE_TWO_FOLLOW_UP",
] as const;

export type SessionFlow = (typeof SESSION_FLOW_VALUES)[number];
export type SessionPhase = "PHASE_ONE" | "PHASE_TWO";
export type SessionPhaseWithClosed = SessionPhase | "CLOSED";

export const SESSION_FLOW_LABELS: Record<SessionFlow, string> = {
  NEW_SESSION: "New Class Session",
  PHASE_ONE_FOLLOW_UP: "Phase 1 Follow-Up",
  PHASE_TWO_CLOSING: "Phase 2 Closing",
  PHASE_TWO_FOLLOW_UP: "Phase 2 Follow-Up",
};

export const SESSION_FLOW_DESCRIPTIONS: Record<SessionFlow, string> = {
  NEW_SESSION:
    "Start a fresh class attendance session. This opens Phase 1 for a new class meeting.",
  PHASE_ONE_FOLLOW_UP:
    "Reopen Phase 1 for the same class session so only students who missed opening attendance can mark.",
  PHASE_TWO_CLOSING:
    "Start the closing phase for an earlier Phase 1 class session.",
  PHASE_TWO_FOLLOW_UP:
    "Reopen Phase 2 for the same class session so only students who missed closing attendance can mark.",
};

export const SESSION_FLOW_PHASES: Record<SessionFlow, SessionPhase> = {
  NEW_SESSION: "PHASE_ONE",
  PHASE_ONE_FOLLOW_UP: "PHASE_ONE",
  PHASE_TWO_CLOSING: "PHASE_TWO",
  PHASE_TWO_FOLLOW_UP: "PHASE_TWO",
};

export function getPhaseForSessionFlow(flow: SessionFlow): SessionPhase {
  return SESSION_FLOW_PHASES[flow];
}

export function getHistoricalPhaseFromSession(input: {
  sessionFlow?: string | null;
  phase?: string | null;
}): SessionPhaseWithClosed {
  const flow =
    typeof input.sessionFlow === "string" && input.sessionFlow.trim().length > 0
      ? getSessionFlowFromUnknown(input.sessionFlow)
      : null;

  if (flow) {
    return getPhaseForSessionFlow(flow);
  }

  if (input.phase === "PHASE_ONE" || input.phase === "PHASE_TWO") {
    return input.phase;
  }

  return "CLOSED";
}

export function getSessionFlowFromUnknown(value: unknown): SessionFlow {
  if (typeof value !== "string") {
    return "NEW_SESSION";
  }

  const normalized = value.trim().toUpperCase();
  if ((SESSION_FLOW_VALUES as readonly string[]).includes(normalized)) {
    return normalized as SessionFlow;
  }

  return "NEW_SESSION";
}

function normalizeIsoDateInput(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

export function getSessionFamilyFallbackKey(input: {
  courseId: string;
  lecturerId?: string | null;
  startedAt: Date | string;
}) {
  const startedAt = normalizeIsoDateInput(input.startedAt);
  const utcDay = new Date(
    Date.UTC(
      startedAt.getUTCFullYear(),
      startedAt.getUTCMonth(),
      startedAt.getUTCDate(),
      0,
      0,
      0,
      0
    )
  )
    .toISOString()
    .slice(0, 10);

  return `${input.courseId}:${input.lecturerId ?? "all"}:${utcDay}`;
}

export function resolveSessionFamilyKey(input: {
  sessionFamilyId?: string | null;
  courseId: string;
  lecturerId?: string | null;
  startedAt: Date | string;
}) {
  if (typeof input.sessionFamilyId === "string" && input.sessionFamilyId.trim().length > 0) {
    return input.sessionFamilyId.trim();
  }

  return getSessionFamilyFallbackKey({
    courseId: input.courseId,
    lecturerId: input.lecturerId,
    startedAt: input.startedAt,
  });
}

export function formatSessionKind(input: {
  sessionFlow?: string | null;
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  phaseRunNumber?: number;
  phaseOneSessionCount?: number;
}) {
  const flow = getSessionFlowFromUnknown(input.sessionFlow);
  const runNumber = Math.max(1, input.phaseRunNumber ?? 1);

  if (input.phase === "CLOSED") {
    return "Closed Session";
  }

  if (flow === "NEW_SESSION") {
    return "Phase 1 Opening";
  }

  if (flow === "PHASE_ONE_FOLLOW_UP") {
    return runNumber > 1 ? `Phase 1 Extension ${runNumber - 1}` : "Phase 1 Extension";
  }

  if (flow === "PHASE_TWO_CLOSING") {
    return "Phase 2 Closing";
  }

  if (flow === "PHASE_TWO_FOLLOW_UP") {
    return runNumber > 1 ? `Phase 2 Extension ${runNumber - 1}` : "Phase 2 Extension";
  }

  if (input.phase === "PHASE_ONE") {
    return "Phase 1 Opening";
  }

  if ((input.phaseOneSessionCount ?? 0) > 0) {
    return "Phase 2 Closing";
  }

  return "Phase 2 Session";
}
