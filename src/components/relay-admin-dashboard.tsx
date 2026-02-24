"use client";

import { useEffect, useState } from "react";
import {
  Bluetooth,
  BarChart3,
  AlertCircle,
  TrendingUp,
  Users,
  Radio,
  Loader2,
} from "lucide-react";

interface RelayStats {
  totalRelays: number;
  pendingApprovals: number;
  approvedRelays: number;
  rejectedRelays: number;
  revokedRelays: number;
  totalRelayScans: number;
  activeRelays: number;
}

interface AdminRelayDashboardProps {
  sessionId: string;
  lecturerId: string;
}

/**
 * Admin Relay Monitoring Dashboard
 * Real-time monitoring of BLE relay devices and scans for a session
 */
export function RelayAdminDashboard({
  sessionId,
  lecturerId,
}: AdminRelayDashboardProps) {
  const [stats, setStats] = useState<RelayStats>({
    totalRelays: 0,
    pendingApprovals: 0,
    approvedRelays: 0,
    rejectedRelays: 0,
    revokedRelays: 0,
    totalRelayScans: 0,
    activeRelays: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/attendance/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "statistics",
            sessionId,
          }),
        });

        const data = await response.json();

        if (data.success) {
          setStats(data.data);
          setError(null);
        } else {
          setError("Failed to load statistics");
        }
      } catch (err) {
        console.error("[v0] Fetch relay stats error:", err);
        setError("Failed to fetch relay statistics");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // Poll every 5 seconds for real-time updates
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const scansPerRelay =
    stats.approvedRelays > 0 ? (stats.totalRelayScans / stats.approvedRelays).toFixed(1) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="surface flex items-center gap-2 p-4">
        <BarChart3 className="h-5 w-5 text-muted-foreground" />
        <div>
          <h3 className="font-semibold">BLE Relay Analytics</h3>
          <p className="text-sm text-muted-foreground">
            Real-time monitoring of peer-to-peer QR broadcasting
          </p>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </p>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="surface rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Relays</p>
              <p className="text-3xl font-bold">{stats.totalRelays}</p>
            </div>
            <Bluetooth className="h-8 w-8 text-muted-foreground/40" />
          </div>
        </div>

        <div className="surface rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Active Now</p>
              <p className="text-3xl font-bold">{stats.activeRelays}</p>
            </div>
            <Radio className="h-8 w-8 text-muted-foreground/40 animate-pulse" />
          </div>
        </div>

        <div className="surface rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Scans via Relay</p>
              <p className="text-3xl font-bold">{stats.totalRelayScans}</p>
            </div>
            <TrendingUp className="h-8 w-8 text-muted-foreground/40" />
          </div>
        </div>

        <div className="surface rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Avg Scans/Relay</p>
              <p className="text-3xl font-bold">{scansPerRelay}</p>
            </div>
            <Users className="h-8 w-8 text-muted-foreground/40" />
          </div>
        </div>
      </div>

      {/* Status Breakdown */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Approval Status */}
        <div className="surface rounded-lg p-4">
          <h4 className="font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            Approval Status
          </h4>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pending</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-muted-foreground/55"
                    style={{
                      width: `${stats.totalRelays > 0 ? (stats.pendingApprovals / stats.totalRelays) * 100 : 0}%`,
                    }}
                  ></div>
                </div>
                <span className="font-semibold min-w-[2rem]">{stats.pendingApprovals}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Approved</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-muted-foreground/75"
                    style={{
                      width: `${stats.totalRelays > 0 ? (stats.approvedRelays / stats.totalRelays) * 100 : 0}%`,
                    }}
                  ></div>
                </div>
                <span className="font-semibold min-w-[2rem]">
                  {stats.approvedRelays}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Rejected</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-destructive/80"
                    style={{
                      width: `${stats.totalRelays > 0 ? (stats.rejectedRelays / stats.totalRelays) * 100 : 0}%`,
                    }}
                  ></div>
                </div>
                <span className="font-semibold min-w-[2rem]">
                  {stats.rejectedRelays}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Revoked</span>
              <div className="flex items-center gap-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-gray-500 h-2 rounded-full"
                    style={{
                      width: `${stats.totalRelays > 0 ? (stats.revokedRelays / stats.totalRelays) * 100 : 0}%`,
                    }}
                  ></div>
                </div>
                <span className="font-semibold min-w-[2rem]">
                  {stats.revokedRelays}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="surface rounded-lg p-4">
          <h4 className="font-semibold mb-4">Session Summary</h4>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded p-2 bg-muted/35">
              <span className="text-muted-foreground">Relay Acceptance Rate</span>
              <span className="font-semibold">
                {stats.totalRelays > 0
                  ? (((stats.approvedRelays + stats.rejectedRelays) / stats.totalRelays) * 100).toFixed(0)
                  : 0}
                %
              </span>
            </div>

            <div className="flex items-center justify-between rounded p-2 bg-muted/35">
              <span className="text-muted-foreground">Avg Students per Relay</span>
              <span className="font-semibold">
                {stats.approvedRelays > 0
                  ? (stats.totalRelayScans / stats.approvedRelays).toFixed(1)
                  : 0}
              </span>
            </div>

            <div className="flex items-center justify-between rounded p-2 bg-muted/35">
              <span className="text-muted-foreground">Total Broadcast Sessions</span>
              <span className="font-semibold">{stats.activeRelays}</span>
            </div>

            <div className="flex items-center justify-between rounded p-2 bg-muted/35">
              <span className="text-muted-foreground">Relay Efficiency</span>
              <span className="font-semibold">
                {stats.approvedRelays > 0
                  ? `${Math.round((stats.totalRelayScans / (stats.approvedRelays * 100)) * 100)}%`
                  : "N/A"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="surface-muted rounded-lg p-4">
        <h4 className="mb-2 font-semibold">System Insights</h4>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {stats.pendingApprovals > 0 && (
            <li>
              There are {stats.pendingApprovals} pending relay device{stats.pendingApprovals === 1 ? "" : "s"} awaiting
              approval.
            </li>
          )}
          {stats.approvedRelays > 0 && stats.totalRelayScans === 0 && (
            <li>Relay devices are approved but haven't been used yet.</li>
          )}
          {stats.totalRelayScans > stats.approvedRelays * 5 && (
            <li>High relay usage - many students are scanning from relay devices.</li>
          )}
          {stats.rejectedRelays > stats.approvedRelays && (
            <li>
              More devices have been rejected than approved. Consider adjusting relay
              approval criteria.
            </li>
          )}
          {stats.totalRelays === 0 && (
            <li>
              No relay devices have been registered yet. Students must verify
              attendance first before becoming relay nodes.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
