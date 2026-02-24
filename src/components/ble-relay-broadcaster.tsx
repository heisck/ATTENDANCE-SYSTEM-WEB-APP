"use client";

import { useEffect, useState } from "react";
import {
  Bluetooth,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";

interface RelayBroadcasterProps {
  sessionId: string;
  studentId: string;
  qrToken: string;
  userDeviceId: string;
  onBroadcasting?: (broadcasting: boolean) => void;
}

/**
 * BLE Relay Broadcaster Component
 * Enables a verified student to broadcast QR code via Bluetooth
 * to friends who have camera issues
 */
export function BleRelayBroadcaster({
  sessionId,
  studentId,
  qrToken,
  userDeviceId,
  onBroadcasting,
}: RelayBroadcasterProps) {
  const [relayDeviceId, setRelayDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "registering" | "pending" | "approved" | "broadcasting" | "error">(
    "idle"
  );
  const [broadcasting, setBroadcasting] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [relayData, setRelayData] = useState<any>(null);
  const [broadcastStats, setBroadcastStats] = useState({
    scanCount: 0,
    lastScanTime: null as Date | null,
  });

  // Register device as relay after verification
  useEffect(() => {
    const registerDevice = async () => {
      try {
        setStatus("registering");
        setMessage("Registering device for relay broadcasting...");

        const response = await fetch("/api/attendance/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "register",
            sessionId,
            userDeviceId,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to register relay device");
        }

        setRelayDeviceId(data.relayDeviceId);
        setStatus("pending");
        setMessage(
          "Device registered! Waiting for lecturer approval to enable relay..."
        );
        setError(null);

        // Poll for approval status
        pollApprovalStatus(data.relayDeviceId);
      } catch (err: any) {
        console.error("[v0] Register relay error:", err);
        setStatus("error");
        setError(err.message || "Failed to register relay device");
        setMessage("");
      }
    };

    registerDevice();
  }, [sessionId, userDeviceId]);

  const pollApprovalStatus = (deviceId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/attendance/relay?sessionId=${sessionId}`
        );
        const data = await response.json();

        if (data.success) {
          // Check if this device is in the list
          const device = data.data.approvedRelays?.find(
            (d: any) => d.id === deviceId
          );
          if (device) {
            setStatus("approved");
            setMessage("Lecturer approved! You can now broadcast.");
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error("[v0] Poll approval error:", err);
      }
    }, 3000); // Check every 3 seconds

    return () => clearInterval(interval);
  };

  const startBroadcasting = async () => {
    if (!relayDeviceId) {
      setError("Relay device ID not found");
      return;
    }

    try {
      setBroadcasting(true);
      setError(null);

      const response = await fetch("/api/attendance/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start_broadcast",
          relayDeviceId,
          sessionId,
          qrToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to start broadcast");
      }

      setRelayData(data.broadcastData);
      setStatus("broadcasting");
      setMessage("Broadcasting active! Friends can now scan your device.");
      toast.success("BLE Relay broadcasting started");
      onBroadcasting?.(true);

      // Poll for broadcast stats
      pollBroadcastStats();
    } catch (err: any) {
      console.error("[v0] Start broadcast error:", err);
      setError(err.message || "Failed to start broadcast");
      setStatus("approved");
      toast.error("Failed to start broadcasting");
      onBroadcasting?.(false);
    } finally {
      setBroadcasting(false);
    }
  };

  const stopBroadcasting = () => {
    setBroadcasting(false);
    setStatus("approved");
    setMessage("Broadcasting stopped");
    setRelayData(null);
    onBroadcasting?.(false);
    toast.info("Broadcasting stopped");
  };

  const pollBroadcastStats = () => {
    const interval = setInterval(() => {
      // In production, fetch actual stats from backend
      // For now, show placeholder
    }, 2000);

    return () => clearInterval(interval);
  };

  const copyBeaconData = () => {
    if (relayData?.bleBeaconUuid) {
      navigator.clipboard.writeText(relayData.bleBeaconUuid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusColor = (currentStatus: string) => {
    switch (currentStatus) {
      case "approved":
      case "broadcasting":
      case "pending":
        return "text-foreground";
      case "error":
        return "text-red-600";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div className="surface space-y-4 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Bluetooth className="h-5 w-5 text-muted-foreground" />
          <div>
            <h4 className="font-semibold">BLE Relay Broadcaster</h4>
            <p className="text-xs text-muted-foreground">
              Share attendance with friends who have camera issues
            </p>
          </div>
        </div>
      </div>

      {/* Status Message */}
      <div
        className={`text-sm font-medium flex items-center gap-2 ${getStatusColor(status)}`}
      >
        {status === "registering" && (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Registering...
          </>
        )}
        {status === "pending" && (
          <>
            <AlertTriangle className="h-4 w-4" />
            Awaiting Approval
          </>
        )}
        {status === "approved" && (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Ready to Broadcast
          </>
        )}
        {status === "broadcasting" && (
          <>
            <Radio className="h-4 w-4 animate-pulse" />
            Broadcasting Active
          </>
        )}
        {status === "error" && (
          <>
            <AlertTriangle className="h-4 w-4" />
            Error
          </>
        )}
      </div>

      {/* Message */}
      {message && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Broadcast Controls */}
      {status === "approved" && !broadcasting && (
        <button
          onClick={startBroadcasting}
          className="w-full flex items-center justify-center gap-2 rounded bg-primary px-4 py-2 font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          <Radio className="h-4 w-4" />
          Start Broadcasting
        </button>
      )}

      {status === "broadcasting" && (
        <>
          <button
            onClick={stopBroadcasting}
            className="w-full flex items-center justify-center gap-2 rounded bg-destructive/10 px-4 py-2 font-medium text-destructive transition hover:bg-destructive/20"
          >
            Stop Broadcasting
          </button>

          {/* Broadcast Details */}
          {relayData && (
            <div className="status-panel-subtle space-y-2">
              <p className="text-xs font-semibold">
                Broadcast Active
              </p>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Beacon UUID: {relayData.bleBeaconUuid?.substring(0, 13)}...</p>
                <p>
                  Broadcast Power: {relayData.broadcastPower} dBm (~
                  {Math.pow(10, (relayData.broadcastPower + 59) / -20).toFixed(0)}m range)
                </p>
                <p>Course: {relayData.courseCode}</p>
              </div>
              <button
                onClick={copyBeaconData}
                className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-foreground/80"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy Beacon ID
                  </>
                )}
              </button>
            </div>
          )}

          {/* Broadcast Stats */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-card border rounded p-2">
              <p className="text-muted-foreground">Scans</p>
              <p className="text-lg font-bold">{broadcastStats.scanCount}</p>
            </div>
            <div className="bg-card border rounded p-2">
              <p className="text-muted-foreground">Status</p>
              <p className="text-sm font-semibold">Live</p>
            </div>
          </div>
        </>
      )}

      {/* Waiting for Approval */}
      {status === "pending" && (
        <div className="status-panel-subtle">
          <p className="text-xs">
            Your device has been registered. The lecturer will review and approve it
            shortly. Once approved, you can start broadcasting your QR code to friends.
          </p>
        </div>
      )}

      {/* Info */}
      <p className="text-xs text-muted-foreground border-t pt-2">
        When you broadcast, friends nearby can scan your Bluetooth signal to get the QR
        code. The broadcaster's range depends on the environment (typically 10-20 meters
        indoors).
      </p>
    </div>
  );
}
