"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function LecturerCourseSelfAssignPanel() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/lecturer/courses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim(),
        }),
      });

      const data = (await response.json()) as {
        id?: string;
        courseId?: string;
        code?: string;
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 409 && data.courseId) {
          toast.success("Course already belongs to you. Opening it now.");
          router.push(`/lecturer/courses/${data.courseId}`);
          router.refresh();
          return;
        }

        throw new Error(data.error || "Failed to assign course to yourself");
      }

      toast.success(
        data.code
          ? `${data.code} is now assigned to you. Add students next.`
          : "Course assigned to you successfully."
      );

      setCode("");
      setName("");
      setDescription("");

      if (data.id) {
        router.push(`/lecturer/courses/${data.id}`);
        router.refresh();
        return;
      }

      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to assign course to yourself"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="assign-course" className="surface p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3">
          <BookPlus className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            Assign A Course To Yourself
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a course you teach to your lecturer workspace, then open it to enroll students.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4 lg:grid-cols-[1fr,1.4fr]">
        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">Course Code</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="CS101"
            required
            maxLength={32}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-foreground">Course Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Introduction to Computer Science"
            required
            maxLength={160}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>

        <label className="space-y-2 lg:col-span-2">
          <span className="text-sm font-medium text-foreground">
            Description
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Optional
            </span>
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add a short note about this course."
            rows={3}
            maxLength={500}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>

        <div className="lg:col-span-2">
          <button
            type="submit"
            disabled={submitting || code.trim().length === 0 || name.trim().length === 0}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Assigning Course...
              </>
            ) : (
              <>
                <BookPlus className="h-4 w-4" />
                Assign Course To Me
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
