"use client";

import { useEffect, useState } from "react";
import { Copy, LoaderCircle, Lock, TimerReset, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  DashboardActionButton,
  DashboardBinaryChoiceField,
  DashboardFieldCard,
} from "@/components/dashboard/dashboard-controls";

type SignupWindowPayload = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  signupWindow: {
    expiresAt: string;
    department: string | null;
    level: number | null;
    groupCode: string | null;
    requireGroup: boolean;
  } | null;
  inviteUrl?: string;
};

export function StudentSignupWindowPanel() {
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<"open" | "close" | "refresh" | "copy" | null>(
    null
  );
  const [data, setData] = useState<SignupWindowPayload | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [ttlMinutes, setTtlMinutes] = useState(10);
  const [department, setDepartment] = useState("");
  const [level, setLevel] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [requireGroup, setRequireGroup] = useState(false);

  async function loadWindow(mode: "initial" | "refresh" = "refresh") {
    if (mode === "initial") {
      setLoading(true);
    } else {
      setPendingAction("refresh");
    }

    try {
      const response = await fetch("/api/lecturer/student-signup-window", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as SignupWindowPayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load signup window.");
      }

      setData(payload);
    } catch (error: any) {
      toast.error(error?.message || "Unable to load signup window.");
    } finally {
      if (mode === "initial") {
        setLoading(false);
      } else {
        setPendingAction(null);
      }
    }
  }

  useEffect(() => {
    void loadWindow("initial");
  }, []);

  async function copyLink(rawLink?: string) {
    const link = rawLink || inviteUrl;
    if (!link) {
      toast.error("Open a new signup window first so you can copy the link.");
      return;
    }

    try {
      setPendingAction("copy");
      await navigator.clipboard.writeText(link);
      toast.success("Signup link copied.");
    } catch {
      toast.error("Could not copy the signup link.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleOpenWindow() {
    setPendingAction("open");
    try {
      const response = await fetch("/api/lecturer/student-signup-window", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ttlMinutes,
          department: department || undefined,
          level: level ? Number(level) : undefined,
          groupCode: groupCode || undefined,
          requireGroup,
        }),
      });

      const payload = (await response.json()) as SignupWindowPayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to open signup window.");
      }

      setData(payload);
      setInviteUrl(payload.inviteUrl || "");
      toast.success("Student signup window is now open.");
    } catch (error: any) {
      toast.error(error?.message || "Unable to open signup window.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCloseWindow() {
    setPendingAction("close");
    try {
      const response = await fetch("/api/lecturer/student-signup-window", {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to close signup window.");
      }

      setData((prev) =>
        prev
          ? {
              ...prev,
              signupWindow: null,
            }
          : prev
      );
      setInviteUrl("");
      toast.success("Student signup window closed.");
    } catch (error: any) {
      toast.error(error?.message || "Unable to close signup window.");
    } finally {
      setPendingAction(null);
    }
  }

  const buttonsBusy = pendingAction !== null;

  return (
    <section className="surface space-y-4 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Student Signup Window</h2>
          <p className="text-sm text-muted-foreground">
            Open a time-bound signup link for students in your school to create accounts.
          </p>
        </div>
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {data?.signupWindow ? (
        <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem label="Closes" value={new Date(data.signupWindow.expiresAt).toLocaleString()} />
            <SummaryItem label="Department" value={data.signupWindow.department || "Any"} />
            <SummaryItem
              label="Level"
              value={data.signupWindow.level != null ? String(data.signupWindow.level) : "Any"}
            />
            <SummaryItem
              label="Group"
              value={
                data.signupWindow.groupCode ||
                (data.signupWindow.requireGroup ? "Required during signup" : "Optional")
              }
            />
          </div>

          <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
            <DashboardActionButton
              type="button"
              onClick={() => void copyLink()}
              icon={Copy}
              loading={pendingAction === "copy"}
              disabled={buttonsBusy}
              className="w-full sm:w-auto sm:min-w-[170px]"
            >
              Copy Latest Link
            </DashboardActionButton>
            <DashboardActionButton
              type="button"
              onClick={() => void handleCloseWindow()}
              icon={XCircle}
              loading={pendingAction === "close"}
              disabled={buttonsBusy}
              variant="danger"
              className="w-full sm:w-auto sm:min-w-[170px]"
            >
              Close Window
            </DashboardActionButton>
          </div>

          {!inviteUrl ? (
            <p className="mt-3 text-xs text-muted-foreground">
              If you need the shareable link again, open a fresh signup window and copy it immediately.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No active student signup window right now.
        </div>
      )}

      {inviteUrl ? (
        <div className="rounded-xl border border-border/70 bg-background/60 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Latest Signup Link
          </p>
          <p className="mt-2 break-all text-sm">{inviteUrl}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <DashboardFieldCard label="Duration (Minutes)">
          <input
            type="number"
            min={1}
            max={180}
            value={ttlMinutes}
            onChange={(event) => setTtlMinutes(Number(event.target.value))}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </DashboardFieldCard>

        <DashboardFieldCard label="Department">
          <input
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="Optional"
          />
        </DashboardFieldCard>

        <DashboardFieldCard label="Level">
          <input
            type="number"
            min={100}
            max={900}
            step={100}
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="Optional"
          />
        </DashboardFieldCard>

        <DashboardFieldCard label="Group">
          <input
            value={groupCode}
            onChange={(event) => setGroupCode(event.target.value)}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="Optional"
          />
        </DashboardFieldCard>

        <DashboardBinaryChoiceField
          label="Require Group"
          description="Choose whether students must enter a group during signup."
          trueLabel="Required"
          falseLabel="Optional"
          value={requireGroup}
          onChange={setRequireGroup}
          className="h-full"
        />
      </div>

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <DashboardActionButton
          type="button"
          onClick={() => void handleOpenWindow()}
          disabled={buttonsBusy}
          icon={UserPlus}
          loading={pendingAction === "open"}
          variant="primary"
          className="w-full sm:w-auto sm:min-w-[170px]"
        >
          Open Signup Window
        </DashboardActionButton>
        <DashboardActionButton
          type="button"
          onClick={() => void loadWindow("refresh")}
          disabled={buttonsBusy}
          icon={TimerReset}
          loading={pendingAction === "refresh"}
          className="w-full sm:w-auto sm:min-w-[170px]"
        >
          Refresh
        </DashboardActionButton>
      </div>

      <div className="rounded-xl border border-border/70 bg-muted/25 p-4 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Students can only create accounts while this window is active. Once it expires, the
            signup page becomes unavailable again.
          </p>
        </div>
      </div>
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
