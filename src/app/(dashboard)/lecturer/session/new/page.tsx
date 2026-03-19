"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bluetooth,
  CheckCircle2,
  Play,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  DashboardActionButton,
  DashboardBinaryChoiceField,
  DashboardFieldCard,
} from "@/components/dashboard/dashboard-controls";
import {
  getHistoricalPhaseFromSession,
  SESSION_FLOW_DESCRIPTIONS,
  SESSION_FLOW_LABELS,
  SESSION_FLOW_VALUES,
  type SessionFlow,
  resolveSessionFamilyKey,
} from "@/lib/session-flow";

interface Course {
  id: string;
  code: string;
  name: string;
}

type SessionRow = {
  id: string;
  courseId: string;
  lecturerId: string;
  sessionFamilyId: string | null;
  sessionFlow: SessionFlow;
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  status: "ACTIVE" | "CLOSED";
  startedAt: string;
  endsAt: string;
  durationMinutes: number;
  course: Course;
};

type SessionFamilySummary = {
  familyKey: string;
  latestSessionId: string;
  startedAt: string;
  phaseOneSessions: number;
  phaseTwoSessions: number;
};

function buildFamilySummaries(sessions: SessionRow[]) {
  const map = new Map<string, SessionFamilySummary>();

  for (const session of sessions) {
    const familyKey = resolveSessionFamilyKey({
      sessionFamilyId: session.sessionFamilyId,
      courseId: session.courseId,
      lecturerId: session.lecturerId,
      startedAt: session.startedAt,
    });

    const current = map.get(familyKey) ?? {
      familyKey,
      latestSessionId: session.id,
      startedAt: session.startedAt,
      phaseOneSessions: 0,
      phaseTwoSessions: 0,
    };

    if (new Date(session.startedAt).getTime() > new Date(current.startedAt).getTime()) {
      current.latestSessionId = session.id;
      current.startedAt = session.startedAt;
    }

    const historicalPhase = getHistoricalPhaseFromSession({
      sessionFlow: session.sessionFlow,
      phase: session.phase,
    });

    if (historicalPhase === "PHASE_ONE") {
      current.phaseOneSessions += 1;
    } else if (historicalPhase === "PHASE_TWO") {
      current.phaseTwoSessions += 1;
    }

    map.set(familyKey, current);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

function familyOptionLabel(summary: SessionFamilySummary) {
  const parts = [
    new Date(summary.startedAt).toLocaleString(),
    `Phase 1 x${summary.phaseOneSessions}`,
    `Phase 2 x${summary.phaseTwoSessions}`,
  ];

  return parts.join(" | ");
}

export default function NewSessionPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [courseCode, setCourseCode] = useState("");
  const [sessionFlow, setSessionFlow] = useState<SessionFlow>("NEW_SESSION");
  const [linkedSessionId, setLinkedSessionId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(4);
  const [bleEnabled, setBleEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const normalizedCourseCode = courseCode.trim().toUpperCase();
  const selectedCourse = courses.find((course) => course.code === normalizedCourseCode) ?? null;
  const courseSessions = sessions.filter(
    (session) => session.course.code.toUpperCase() === normalizedCourseCode
  );
  const familySummaries = buildFamilySummaries(courseSessions);
  const selectableFamilies = familySummaries.filter((summary) => {
    if (sessionFlow === "NEW_SESSION") {
      return false;
    }

    if (sessionFlow === "PHASE_ONE_FOLLOW_UP") {
      return summary.phaseOneSessions > 0 && summary.phaseTwoSessions === 0;
    }

    if (sessionFlow === "PHASE_TWO_CLOSING") {
      return summary.phaseOneSessions > 0 && summary.phaseTwoSessions === 0;
    }

    return summary.phaseTwoSessions > 0;
  });

  useEffect(() => {
    async function loadData() {
      try {
        const [coursesResponse, sessionsResponse] = await Promise.all([
          fetch("/api/courses", { cache: "no-store" }),
          fetch("/api/attendance/sessions?status=ALL&take=100", { cache: "no-store" }),
        ]);
        const [coursePayload, sessionPayload] = await Promise.all([
          coursesResponse.json(),
          sessionsResponse.json(),
        ]);

        if (Array.isArray(coursePayload)) {
          setCourses(coursePayload);
        }
        if (Array.isArray(sessionPayload)) {
          setSessions(sessionPayload);
        }
      } catch {
        toast.error("Unable to load course session context right now.");
      }
    }

    void loadData();
  }, []);

  useEffect(() => {
    if (sessionFlow === "NEW_SESSION") {
      setLinkedSessionId("");
      return;
    }

    const stillSelected = selectableFamilies.some(
      (summary) => summary.latestSessionId === linkedSessionId
    );
    if (!stillSelected) {
      setLinkedSessionId(selectableFamilies[0]?.latestSessionId || "");
    }
  }, [linkedSessionId, selectableFamilies, sessionFlow]);

  async function handleStart() {
    if (!courseCode.trim()) return;

    if (sessionFlow !== "NEW_SESSION" && !linkedSessionId) {
      toast.error("Select the earlier class session you want to continue.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/attendance/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseCode: normalizedCourseCode,
          sessionFlow,
          linkedSessionId: sessionFlow === "NEW_SESSION" ? undefined : linkedSessionId,
          durationMinutes,
          enableBle: bleEnabled,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.sessionId) {
          toast.message(
            data?.error || "This course already has an active session. Continue it or extend it from the live monitor."
          );
          router.push(`/lecturer/session/${data.sessionId}`);
          return;
        }

        throw new Error(data.error || "Failed to create session");
      }

      router.push(`/lecturer/session/${data.id}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to create session");
    } finally {
      setLoading(false);
    }
  }

  const selectedFamily =
    selectableFamilies.find((summary) => summary.latestSessionId === linkedSessionId) ?? null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <section className="surface space-y-5 p-4 sm:p-6">
          <div className="space-y-2">
            <label htmlFor="courseCode" className="text-sm font-medium">
              Enter Course Code
            </label>
            <input
              id="courseCode"
              list="course-codes"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
              placeholder="e.g. CS351"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <datalist id="course-codes">
              {courses.map((course) => (
                <option key={course.id} value={course.code} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Session starts only if this exact course code belongs to you.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Session Flow</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SESSION_FLOW_VALUES.map((flow) => (
                <button
                  key={flow}
                  type="button"
                  onClick={() => setSessionFlow(flow)}
                  className={`rounded-xl border px-3 py-3 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out hover:shadow-sm active:translate-y-px active:scale-[0.99] sm:px-4 ${
                    sessionFlow === flow
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border/70 bg-background/40 hover:bg-accent"
                  }`}
                >
                  <p className="text-sm font-semibold">{SESSION_FLOW_LABELS[flow]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {SESSION_FLOW_DESCRIPTIONS[flow]}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {sessionFlow !== "NEW_SESSION" ? (
            <div className="space-y-2">
              <label htmlFor="linkedSessionId" className="text-sm font-medium">
                Earlier Class Session
              </label>
              <select
                id="linkedSessionId"
                value={linkedSessionId}
                onChange={(event) => setLinkedSessionId(event.target.value)}
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select an earlier class session</option>
                {selectableFamilies.map((summary) => (
                  <option key={summary.familyKey} value={summary.latestSessionId}>
                    {familyOptionLabel(summary)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Pick the earlier class session you want to continue or close.
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <DashboardFieldCard label="Duration (Minutes)">
              <input
                id="durationMinutes"
                type="number"
                min={1}
                max={60}
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <p className="text-xs text-muted-foreground">
                Set how long this attendance window should stay open.
              </p>
            </DashboardFieldCard>

            <DashboardBinaryChoiceField
              label="Bluetooth Mode"
              description={
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-foreground">
                    <Bluetooth className="h-4 w-4 text-muted-foreground" />
                    Enable BLE broadcaster support.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Beacon identity remains deterministic and tied to the session ID.
                  </p>
                </div>
              }
              trueLabel="Enabled"
              falseLabel="Disabled"
              value={bleEnabled}
              onChange={setBleEnabled}
              className="h-full"
            />
          </div>

          <DashboardActionButton
            type="button"
            onClick={() => void handleStart()}
            disabled={!courseCode.trim() || loading}
            variant="primary"
            icon={Play}
            loading={loading}
            fullWidth
            className="h-12"
          >
            Start {SESSION_FLOW_LABELS[sessionFlow]}
          </DashboardActionButton>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <section className="surface p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Session Preview
            </h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Course</p>
                <p className="mt-1 text-sm font-medium">
                  {selectedCourse
                    ? `${selectedCourse.code} - ${selectedCourse.name}`
                    : "Not selected yet"}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Flow</p>
                <p className="mt-1 inline-flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-foreground" />
                  {SESSION_FLOW_LABELS[sessionFlow]}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Timer</p>
                <p className="mt-1 text-sm font-medium">
                  QR rotates every 5 seconds for {durationMinutes} minute
                  {durationMinutes === 1 ? "" : "s"}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Linked Session</p>
                <p className="mt-1 text-sm font-medium">
                  {selectedFamily ? familyOptionLabel(selectedFamily) : "No earlier class session selected"}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">BLE</p>
                <p className="mt-1 text-sm font-medium">
                  {bleEnabled
                    ? "Enabled (Android broadcaster required)"
                    : "Disabled (QR mode only)"}
                </p>
              </div>
            </div>
          </section>

          <section className="surface-muted p-4 sm:p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" />
              Before You Start
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>Use New Class Session to begin a fresh Phase 1 attendance window.</li>
              <li>Use follow-up flows only when you want to continue the same class session.</li>
              <li>Students who already completed that phase will be blocked from re-marking in the follow-up.</li>
              <li>Full attendance is counted only when the student completes both phases in the same class session.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
