"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Bluetooth,
  CheckCircle2,
  Loader2,
  Play,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";

interface Course {
  id: string;
  code: string;
  name: string;
}

type AttendancePhase = "PHASE_ONE" | "PHASE_TWO";

const phaseLabels: Record<AttendancePhase, string> = {
  PHASE_ONE: "Phase 1 (Opening)",
  PHASE_TWO: "Phase 2 (Closing)",
};

export default function NewSessionPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseCode, setCourseCode] = useState("");
  const [phase, setPhase] = useState<AttendancePhase>("PHASE_ONE");
  const [bleEnabled, setBleEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const normalizedCourseCode = courseCode.trim().toUpperCase();
  const selectedCourse = courses.find((course) => course.code === normalizedCourseCode) ?? null;

  useEffect(() => {
    fetch("/api/courses")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCourses(data);
      })
      .catch(() => {});
  }, []);

  async function handleStart() {
    if (!courseCode.trim()) return;

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        courseCode: courseCode.trim().toUpperCase(),
        phase,
        enableBle: bleEnabled,
      };

      const res = await fetch("/api/attendance/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.sessionId) {
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lecturer"
        title="Start Attendance Session"
        description="Select course and phase, then launch the 4-minute rotating QR session."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="surface space-y-6 p-5 sm:p-6">
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
              {courses.map((c) => (
                <option key={c.id} value={c.code} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Session starts only if this exact course code belongs to you.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Attendance Phase</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["PHASE_ONE", "PHASE_TWO"] as AttendancePhase[]).map((phaseKey) => (
                <button
                  key={phaseKey}
                  type="button"
                  onClick={() => setPhase(phaseKey)}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    phase === phaseKey
                      ? "border-primary bg-primary/10"
                      : "border-border/70 bg-background/40 hover:bg-accent"
                  }`}
                >
                  <p className="text-sm font-semibold">{phaseLabels[phaseKey]}</p>
                  <p className="text-xs text-muted-foreground">Duration: 4 minutes</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-background/40 p-4">
            <div className="flex items-center gap-2">
              <Bluetooth className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Bluetooth Mode</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bleEnabled}
                onChange={(event) => setBleEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Enable BLE (requires Android broadcaster app heartbeat)
            </label>
            <p className="text-xs text-muted-foreground">
              Beacon identity is deterministic and generated as:
              <span className="font-mono"> ATD-&lt;COURSE&gt;-P&lt;PH&gt;-&lt;ID&gt;</span>
            </p>
          </div>

          <button
            onClick={handleStart}
            disabled={!courseCode.trim() || loading}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Play className="h-5 w-5" />
                Start Session
              </>
            )}
          </button>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <section className="surface p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Session Preview
            </h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Course</p>
                <p className="mt-1 text-sm font-medium">
                  {selectedCourse ? `${selectedCourse.code} - ${selectedCourse.name}` : "Not selected yet"}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Phase</p>
                <p className="mt-1 inline-flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-foreground" />
                  {phaseLabels[phase]}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Timer</p>
                <p className="mt-1 text-sm font-medium">QR rotates every 5 seconds for 4 minutes</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">BLE</p>
                <p className="mt-1 text-sm font-medium">
                  {bleEnabled
                    ? "Enabled (Android broadcaster required)"
                    : "Disabled (QR mode available)"}
                </p>
              </div>
            </div>
          </section>

          <section className="surface-muted p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" />
              Before You Start
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>Keep this tab open so students can scan the rotating QR code.</li>
              <li>Select the correct phase before you launch.</li>
              <li>Use Phase 1 at class start and Phase 2 near class end.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
