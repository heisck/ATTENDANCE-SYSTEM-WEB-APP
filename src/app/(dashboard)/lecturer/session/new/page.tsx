"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GpsCheck } from "@/components/gps-check";
import { CheckCircle2, Loader2, MapPin, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import ElasticSlider from "@/components/ui/elastic-slider";
import { PageHeader } from "@/components/dashboard/page-header";

interface Course {
  id: string;
  code: string;
  name: string;
}

export default function NewSessionPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseCode, setCourseCode] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(500);
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
    if (!courseCode.trim() || !gps) return;

    setLoading(true);

    try {
      const res = await fetch("/api/attendance/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseCode: courseCode.trim().toUpperCase(),
          gpsLat: gps.lat,
          gpsLng: gps.lng,
          radiusMeters: radius,
        }),
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
        description="Create a new session and display the QR code for students."
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Radius and GPS accuracy: {radius}m</label>
            <ElasticSlider
              className="pb-4"
              startingValue={50}
              defaultValue={radius}
              value={radius}
              maxValue={2000}
              valueFormatter={(value) => `${Math.round(value)}m`}
              onValueChange={(value) => setRadius(Math.round(value))}
            />
            <p className="text-xs text-muted-foreground">
              Students must be within this distance, and both you and students must calibrate GPS
              until accuracy is &lt;= {radius}m.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Capture session location</p>
            <GpsCheck onLocationReady={(lat, lng) => setGps({ lat, lng })} maxAccuracyMeters={radius} />
          </div>

          <button
            onClick={handleStart}
            disabled={!courseCode.trim() || !gps || loading}
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
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Radius</p>
                <p className="mt-1 text-sm font-medium">{radius} meters</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Lecturer GPS</p>
                <p className="mt-1 inline-flex items-center gap-2 text-sm font-medium">
                  {gps ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-foreground" />
                      Ready
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      Waiting for location
                    </>
                  )}
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
              <li>Use an accurate GPS fix at your lecture location.</li>
              <li>Verify course code carefully before launching the session.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
