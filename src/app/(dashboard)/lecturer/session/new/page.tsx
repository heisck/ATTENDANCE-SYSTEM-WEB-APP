"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GpsCheck } from "@/components/gps-check";
import { Loader2, Play } from "lucide-react";

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
  const [error, setError] = useState("");

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
    setError("");

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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Start Attendance Session</h1>
        <p className="text-muted-foreground">
          Create a new session and display the QR code for students
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="courseCode" className="text-sm font-medium">Enter Course Code</label>
          <input
            id="courseCode"
            list="course-codes"
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
            placeholder="e.g. CS351"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <label className="text-sm font-medium">
            Radius: {radius}m
          </label>
          <input
            type="range"
            min={50}
            max={2000}
            step={50}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Students must be within this distance to mark attendance
          </p>
        </div>

        <GpsCheck
          onLocationReady={(lat, lng) => setGps({ lat, lng })}
          maxAccuracyMeters={50}
        />

        <button
          onClick={handleStart}
          disabled={!courseCode.trim() || !gps || loading}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
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
      </div>
    </div>
  );
}
