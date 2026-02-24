"use client";

import { useEffect, useState } from "react";
import { Bluetooth, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface RelayDevice {
  id: string;
  studentId: string;
  studentName: string;
  deviceName: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
  verifiedAt: string;
  approvedAt?: string;
  relayScansCount: number;
  broadcastRangeMeters: number;
}

interface RelayApprovalPanelProps {
  sessionId: string;
  lecturerId: string;
  isLive?: boolean;
}

export function RelayApprovalPanel({
  sessionId,
  lecturerId,
  isLive = true,
}: RelayApprovalPanelProps) {
  const [devices, setDevices] = useState<RelayDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalRelays: 0,
    pendingApprovals: 0,
    approvedRelays: 0,
    rejectedRelays: 0,
    totalRelayScans: 0,
    activeRelays: 0,
  });
  const [approving, setApproving] = useState<string | null>(null);

  // Fetch relay devices and statistics
  useEffect(() => {
    const fetchData = async () => {
      try {
        // In production, you'd fetch from actual API
        // This is a placeholder for the real implementation
        setLoading(false);
      } catch (error) {
        console.error("Failed to fetch relay devices:", error);
        toast.error("Failed to load relay devices");
        setLoading(false);
      }
    };

    fetchData();

    // Poll for updates every 5 seconds if live
    let interval: NodeJS.Timeout;
    if (isLive) {
      interval = setInterval(fetchData, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [sessionId, isLive]);

  const handleApprove = async (relayDeviceId: string) => {
    setApproving(relayDeviceId);
    try {
      const response = await fetch("/api/attendance/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          relayDeviceId,
          sessionId,
          message: "Approved by lecturer",
        }),
      });

      if (!response.ok) throw new Error("Failed to approve");

      toast.success("Device approved for relay broadcasting");
      // Refresh data
      window.location.reload();
    } catch (error) {
      toast.error("Failed to approve device");
      console.error(error);
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (relayDeviceId: string) => {
    setApproving(relayDeviceId);
    try {
      const response = await fetch("/api/attendance/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          relayDeviceId,
          sessionId,
          message: "Rejected by lecturer",
        }),
      });

      if (!response.ok) throw new Error("Failed to reject");

      toast.success("Device rejected");
      window.location.reload();
    } catch (error) {
      toast.error("Failed to reject device");
      console.error(error);
    } finally {
      setApproving(null);
    }
  };

  const handleRevoke = async (relayDeviceId: string) => {
    if (!confirm("Are you sure you want to revoke this relay device?")) {
      return;
    }

    setApproving(relayDeviceId);
    try {
      const response = await fetch("/api/attendance/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "revoke",
          relayDeviceId,
          sessionId,
          reason: "Revoked by lecturer",
        }),
      });

      if (!response.ok) throw new Error("Failed to revoke");

      toast.success("Device revoked");
      window.location.reload();
    } catch (error) {
      toast.error("Failed to revoke device");
      console.error(error);
    } finally {
      setApproving(null);
    }
  };

  const pendingDevices = devices.filter((d) => d.status === "PENDING");
  const approvedDevices = devices.filter((d) => d.status === "APPROVED");
  const rejectedDevices = devices.filter((d) => d.status === "REJECTED");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2 border-b pb-4">
        <Bluetooth className="h-5 w-5 text-blue-600" />
        <div>
          <h3 className="font-semibold">BLE Relay Device Management</h3>
          <p className="text-sm text-muted-foreground">
            Approve devices that can broadcast QR codes to students with camera issues
          </p>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Relays</p>
          <p className="text-2xl font-bold">{stats.totalRelays}</p>
        </div>
        <div className="bg-card border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Pending</p>
          <p className="text-2xl font-bold text-amber-600">
            {stats.pendingApprovals}
          </p>
        </div>
        <div className="bg-card border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-green-600">{stats.approvedRelays}</p>
        </div>
        <div className="bg-card border rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Relay Scans</p>
          <p className="text-2xl font-bold">{stats.totalRelayScans}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending Approvals */}
          {pendingDevices.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                Pending Approval ({pendingDevices.length})
              </h4>
              <div className="space-y-2">
                {pendingDevices.map((device) => (
                  <div
                    key={device.id}
                    className="border rounded-lg p-4 flex items-between gap-4"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{device.studentName}</p>
                      <p className="text-sm text-muted-foreground">
                        {device.deviceName} • Range: {device.broadcastRangeMeters}m
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Verified:{" "}
                        {new Date(device.verifiedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(device.id)}
                        disabled={approving === device.id}
                        className="flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50 text-sm"
                      >
                        {approving === device.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(device.id)}
                        disabled={approving === device.id}
                        className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 text-sm"
                      >
                        {approving === device.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approved Devices */}
          {approvedDevices.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Active Relays ({approvedDevices.length})
              </h4>
              <div className="space-y-2">
                {approvedDevices.map((device) => (
                  <div
                    key={device.id}
                    className="border border-green-200 bg-green-50 rounded-lg p-4 flex items-between gap-4"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{device.studentName}</p>
                      <p className="text-sm text-muted-foreground">
                        {device.deviceName} • {device.relayScansCount} scans
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Approved:{" "}
                        {device.approvedAt
                          ? new Date(device.approvedAt).toLocaleTimeString()
                          : "N/A"}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRevoke(device.id)}
                      disabled={approving === device.id}
                      className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 text-sm"
                    >
                      {approving === device.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rejected/Revoked */}
          {rejectedDevices.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-600" />
                Rejected ({rejectedDevices.length})
              </h4>
              <div className="space-y-2">
                {rejectedDevices.map((device) => (
                  <div
                    key={device.id}
                    className="border border-red-200 bg-red-50 rounded-lg p-4"
                  >
                    <p className="font-medium">{device.studentName}</p>
                    <p className="text-sm text-muted-foreground">
                      {device.deviceName}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {devices.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No relay devices registered for this session yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
