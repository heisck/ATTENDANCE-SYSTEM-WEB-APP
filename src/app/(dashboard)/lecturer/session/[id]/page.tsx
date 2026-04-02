"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  DashboardActionButton,
  getDashboardButtonClassName,
} from "@/components/dashboard/dashboard-controls";
import { QrDisplay } from "@/components/qr-display";
import { QrPortApprovalPanel } from "@/components/qr-port-approval-panel";
import { LecturerBleBroadcasterSync } from "@/components/lecturer-ble-broadcaster-sync";
import {
  Users,
  Clock,
  StopCircle,
  Loader2,
  Bluetooth,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

interface SessionData {
  id: string;
  status: string;
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  phaseEndsAt: string;
  startedAt: string;
  courseEnrollmentCount: number;
  course: { code: string; name: string };
  records: {
    id: string;
    markedAt: string;
    confidence: number;
    flagged: boolean;
    student: { id: string; name: string; studentId: string | null };
  }[];
  _count: { records: number };
}

interface BleStatus {
  enabled: boolean;
  active: boolean;
  beaconName: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  lastHeartbeatAt: string | null;
  broadcasterDeviceName?: string | null;
  serviceUuid: string;
  currentTokenCharacteristicUuid: string;
  sessionMetaCharacteristicUuid: string;
  manufacturerCompanyId: number;
  manufacturerDataHex: string | null;
  phase: "PHASE_ONE" | "PHASE_TWO" | "CLOSED";
  phaseEndsAt: string;
}

function getPhaseLabel(phase: SessionData["phase"]) {
  if (phase === "PHASE_ONE") return "Phase 1";
  if (phase === "PHASE_TWO") return "Phase 2";
  return "Closed";
}

export default function SessionMonitorPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const [data, setData] = useState<SessionData | null>(null);
  const [bleStatus, setBleStatus] = useState<BleStatus | null>(null);
  const [bleAction, setBleAction] = useState<"start" | "stop" | "refresh" | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [sessionUnavailableMessage, setSessionUnavailableMessage] = useState(
    "This session is no longer available."
  );

  const fetchSession = useCallback(async (mode: "initial" | "poll" | "refresh" = "refresh") => {
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}`);
      const body = await res.json().catch(() => ({}));

      if (res.status === 404) {
        if (mode === "poll" && !sessionUnavailable) {
          toast.info("This session is no longer available.");
        }
        setSessionUnavailable(true);
        setSessionUnavailableMessage(body?.error || "This session is no longer available.");
        setData(null);
        setBleStatus(null);
        return;
      }

      if (!res.ok) {
        throw new Error(body?.error || "Failed to load session.");
      }

      setSessionUnavailable(false);
      setSessionUnavailableMessage("This session is no longer available.");
      setData(body);
      if (body.status !== "ACTIVE") {
        setBleStatus({
          enabled: false,
          active: false,
          beaconName: null,
          startedAt: null,
          expiresAt: null,
          lastHeartbeatAt: null,
          serviceUuid: "",
          currentTokenCharacteristicUuid: "",
          sessionMetaCharacteristicUuid: "",
          phase: "CLOSED",
          phaseEndsAt: new Date().toISOString(),
          manufacturerCompanyId: 0xffff,
          manufacturerDataHex: null,
        });
      }
    } catch (error: any) {
      if (mode !== "poll") {
        toast.error(error?.message || "Unable to load this session.");
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, sessionUnavailable]);

  const fetchBleStatus = useCallback(async (mode: "auto" | "manual" = "auto") => {
    if (mode === "manual") {
      setBleAction("refresh");
    }

    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}/ble`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (res.status === 404) {
        setBleStatus(null);
        return;
      }
      if (!res.ok) return;
      setBleStatus(body);
    } catch {
      // no-op
    } finally {
      if (mode === "manual") {
        setBleAction(null);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchSession("initial");
  }, [fetchSession]);

  useEffect(() => {
    if (sessionUnavailable || data?.status !== "ACTIVE") return;

    void fetchBleStatus("auto");
    const interval = window.setInterval(() => {
      void fetchSession("poll");
      void fetchBleStatus("auto");
    }, 5000);
    return () => window.clearInterval(interval);
  }, [data?.status, fetchBleStatus, fetchSession, sessionUnavailable]);

  async function handleStartBle() {
    if (!data) return;
    setBleAction("start");
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}/ble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to start BLE broadcast");
      }
      setBleStatus(body);
      toast.success("Lecturer BLE beacon enabled.");
    } catch (error: any) {
      toast.error(error.message || "Unable to start BLE beacon");
    } finally {
      setBleAction(null);
    }
  }

  async function handleStopBle() {
    setBleAction("stop");
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}/ble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || "Failed to stop BLE broadcast");
      }
      setBleStatus(body);
      toast.success("Lecturer BLE beacon stopped.");
    } catch (error: any) {
      toast.error(error.message || "Unable to stop BLE beacon");
    } finally {
      setBleAction(null);
    }
  }

  async function handleClose() {
    if (!confirm("Are you sure you want to close this session?")) return;

    setClosing(true);
    try {
      const res = await fetch(`/api/attendance/sessions/${sessionId}`, {
        method: "PATCH",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || "Failed to close session");
      }
      await fetchSession();
      setBleStatus({
        enabled: false,
        active: false,
        beaconName: null,
        startedAt: null,
        expiresAt: null,
        lastHeartbeatAt: null,
        serviceUuid: "",
        currentTokenCharacteristicUuid: "",
        sessionMetaCharacteristicUuid: "",
        phase: "CLOSED",
        phaseEndsAt: new Date().toISOString(),
        manufacturerCompanyId: 0xffff,
        manufacturerDataHex: null,
      });
      toast.success("Session closed.");
    } catch (error: any) {
      toast.error(error?.message || "Unable to close session");
    } finally {
      setClosing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    if (sessionUnavailable) {
      return (
        <div className="space-y-4 rounded-2xl border border-border/70 bg-background/40 p-6 text-center">
          <p className="text-lg font-semibold">Session unavailable</p>
          <p className="text-sm text-muted-foreground">{sessionUnavailableMessage}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/lecturer/history"
              className={getDashboardButtonClassName()}
            >
              Open Session History
            </Link>
            <Link
              href="/lecturer"
              className={getDashboardButtonClassName()}
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Session not found.</p>
      </div>
    );
  }

  const isActive = data.status === "ACTIVE";
  const bleBusy = bleAction !== null;
  const markedCount = data._count.records;
  const enrolledCount = data.courseEnrollmentCount;
  const remainingCount = Math.max(enrolledCount - markedCount, 0);
  const completionRate =
    enrolledCount > 0 ? Math.round((markedCount / enrolledCount) * 100) : 0;

  return (
    <div className="space-y-6">
      <LecturerBleBroadcasterSync
        sessionId={sessionId}
        sessionActive={isActive}
        enabled={Boolean(bleStatus?.enabled)}
        beaconName={bleStatus?.beaconName ?? null}
        serviceUuid={bleStatus?.serviceUuid ?? ""}
        currentTokenCharacteristicUuid={bleStatus?.currentTokenCharacteristicUuid ?? ""}
        sessionMetaCharacteristicUuid={bleStatus?.sessionMetaCharacteristicUuid ?? ""}
      />

      <div className="page-header-block space-y-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {data.course.code} - {data.course.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Started {new Date(data.startedAt).toLocaleTimeString()}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {markedCount}/{enrolledCount} students marked
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Phase ends {new Date(data.phaseEndsAt).toLocaleTimeString()}
            </span>
            <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {data.status}
            </span>
            <span className="rounded-full border border-border/70 bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {getPhaseLabel(data.phase)}
            </span>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <a
            href={`/api/reports/export?sessionId=${sessionId}&format=csv`}
            className={getDashboardButtonClassName({ className: "w-full" })}
          >
            <FileText className="h-4 w-4" />
            Export CSV
          </a>
          <a
            href={`/api/reports/export?sessionId=${sessionId}&format=xlsx`}
            className={getDashboardButtonClassName({ className: "w-full" })}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </a>
          <a
            href={`/api/reports/export?sessionId=${sessionId}&format=pdf`}
            className={getDashboardButtonClassName({ className: "w-full" })}
          >
            <FileText className="h-4 w-4" />
            Export PDF
          </a>
          {isActive && (
            <DashboardActionButton
              type="button"
              onClick={() => void handleClose()}
              disabled={closing}
              variant="danger"
              icon={StopCircle}
              loading={closing}
              className="w-full"
            >
              End Session
            </DashboardActionButton>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="surface space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {isActive ? "Live QR Code" : "Session Summary"}
            </h2>
            <span className="rounded-full border border-border/70 bg-muted px-3 py-1 text-xs font-medium text-foreground">
              {markedCount}/{enrolledCount} marked
            </span>
          </div>

          {isActive ? (
            <QrDisplay sessionId={sessionId} />
          ) : (
            <div className="rounded-2xl border border-border/70 bg-background/40 p-6 text-center text-sm text-muted-foreground">
              This attendance session is closed. The live QR code is no longer active.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border/70 bg-background/40 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Marked
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {markedCount}
                <span className="ml-2 text-sm font-medium text-muted-foreground">
                  / {enrolledCount}
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/40 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Remaining
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{remainingCount}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/40 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Completion
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{completionRate}%</p>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/40 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Bluetooth className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold">Lecturer BLE Broadcast</p>
            </div>
            {!bleStatus ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading BLE status...
              </div>
            ) : (
              <div className="space-y-2">
                <div className="status-panel-subtle text-xs">
                  <p className="font-semibold">
                    Expected Beacon Name: {bleStatus.beaconName ?? "Not available"}
                  </p>
                  <p className="text-muted-foreground">Service UUID: {bleStatus.serviceUuid}</p>
                  <p className="text-muted-foreground">
                    Token Char: {bleStatus.currentTokenCharacteristicUuid}
                  </p>
                  <p className="text-muted-foreground">
                    Meta Char: {bleStatus.sessionMetaCharacteristicUuid}
                  </p>
                  <p className="text-muted-foreground">
                    Manufacturer: 0x{bleStatus.manufacturerCompanyId.toString(16).toUpperCase()} · Data: {bleStatus.manufacturerDataHex ?? "N/A"}
                  </p>
                </div>
                {bleStatus.enabled ? (
                  <div className="status-panel-subtle text-xs">
                    <p className="font-semibold">
                      Android Broadcaster: {bleStatus.active ? "Active" : "No heartbeat yet"}
                    </p>
                    {!bleStatus.active ? (
                      <p className="text-muted-foreground">
                        If broadcaster is external and not sending heartbeat, students can still try BLE scan.
                      </p>
                    ) : null}
                    {bleStatus.broadcasterDeviceName ? (
                      <p className="text-muted-foreground">
                        Device: {bleStatus.broadcasterDeviceName}
                      </p>
                    ) : null}
                    {bleStatus.lastHeartbeatAt ? (
                      <p className="text-muted-foreground">
                        Last heartbeat {new Date(bleStatus.lastHeartbeatAt).toLocaleTimeString()}
                      </p>
                    ) : null}
                    {bleStatus.expiresAt ? (
                      <p className="text-muted-foreground">
                        BLE mode until {new Date(bleStatus.expiresAt).toLocaleTimeString()}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Beacon is currently off.
                  </p>
                )}
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  <DashboardActionButton
                    type="button"
                    onClick={() => void handleStartBle()}
                    disabled={bleBusy}
                    variant={bleStatus.enabled ? "secondary" : "primary"}
                    loading={bleAction === "start"}
                    className="h-9 min-w-0 px-1.5 text-[10px] leading-none sm:px-2 sm:text-xs"
                  >
                    <span className="truncate">Enable BLE</span>
                  </DashboardActionButton>
                  <DashboardActionButton
                    type="button"
                    onClick={() => void handleStopBle()}
                    disabled={bleBusy || !bleStatus?.enabled}
                    loading={bleAction === "stop"}
                    className="h-9 min-w-0 px-1.5 text-[10px] leading-none sm:px-2 sm:text-xs"
                  >
                    <span className="truncate">Disable BLE</span>
                  </DashboardActionButton>
                  <DashboardActionButton
                    type="button"
                    onClick={() => void fetchBleStatus("manual")}
                    disabled={bleBusy}
                    loading={bleAction === "refresh"}
                    className="h-9 min-w-0 px-1.5 text-[10px] leading-none sm:px-2 sm:text-xs"
                  >
                    <span className="truncate">Refresh</span>
                  </DashboardActionButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isActive && (
        <div className="w-full">
          <QrPortApprovalPanel sessionId={sessionId} isLive />
        </div>
      )}
    </div>
  );
}
