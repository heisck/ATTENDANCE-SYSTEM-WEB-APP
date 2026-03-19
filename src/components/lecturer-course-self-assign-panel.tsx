"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookPlus } from "lucide-react";
import { toast } from "sonner";
import { DashboardActionButton } from "@/components/dashboard/dashboard-controls";

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
    <section id="assign-course" className="surface p-4 sm:p-5">
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

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4 md:grid-cols-[1fr,1.4fr]">
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

        <div className="md:col-span-2">
          <DashboardActionButton
            type="submit"
            disabled={submitting || code.trim().length === 0 || name.trim().length === 0}
            variant="primary"
            icon={BookPlus}
            loading={submitting}
            className="w-full sm:w-auto"
          >
            {submitting ? "Assigning Course..." : "Assign Course To Me"}
          </DashboardActionButton>
        </div>
      </form>
    </section>
  );
}
