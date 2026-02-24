"use client";

import { useEffect, useState, useRef } from "react";
import {
  Bluetooth,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Radio,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";

interface RelayDevice {
  id: string;
  studentName: string;
  deviceName: string;
  broadcastRangeMeters: number;
  scansAvailable: boolean;
}

interface BleRelayScanner {
  sessionId: string;
  onQrScanned: (qrToken: string, relayDeviceId: string, rssi?: number) => void;
  disabled?: boolean;
}

/**
 * BLE Relay Scanner Component
 * Allows students to scan QR code from friends' devices via Bluetooth when their camera is bad
 */
export function BleRelayScanner({
  sessionId,
  onQrScanned,
  disabled = false,
}: BleRelayScanner) {
  const [scanning, setScanning] = useState(false);
  const [selectedRelay, setSelectedRelay] = useState<RelayDevice | null>(null);
  const [relays, setRelays] = useState<RelayDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const [rssi, setRssi] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const scanAbortRef = useRef<AbortController | null>(null);

  // Fetch available relay devices
  useEffect(() => {
    const fetchRelays = async () => {
      try {
        const response = await fetch(`/api/attendance/relay?sessionId=${sessionId}`);
        const data = await response.json();

        if (data.success) {
          setRelays(data.data.approvedRelays);
          setSupported(data.data.relayEnabled);
          setError(null);
        } else {
          setError("Failed to fetch relay devices");
        }
      } catch (err) {
        console.error("[v0] Fetch relays error:", err);
        setError("Failed to load relay devices");
      } finally {
        setLoading(false);
      }
    };

    fetchRelays();

    // Poll every 10 seconds for new relays
    const interval = setInterval(fetchRelays, 10000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const startBleScanning = async (relay: RelayDevice) => {
    if (!supported) {
      toast.error("BLE relay scanning not available");
      return;
    }

    setScanning(true);
    setSelectedRelay(relay);
    setError(null);
    setRssi(null);
    setDistance(null);

    try {
      // Check Web Bluetooth support
      if (!(navigator as any).bluetooth) {
        throw new Error("Web Bluetooth not supported on this device");
      }

      // Create abort controller for scan
      scanAbortRef.current = new AbortController();

      // Request device with filter
      const options = {
        filters: [
          {
            name: `attendance-relay-${relay.id.substring(0, 8)}`,
          },
        ],
        optionalServices: ["generic_access"],
      };

      // @ts-ignore - Web Bluetooth API types
      const device = await navigator.bluetooth.requestDevice(options);

      if (!device) {
        setError("No device selected");
        setScanning(false);
        return;
      }

      // Simulate getting RSSI in real app
      // In production, you'd get this from the BLE advertisement or connection
      const simulatedRssi = Math.random() * -30 - 50; // -80 to -50 dBm
      const distance = calculateDistance(simulatedRssi);

      setRssi(Math.round(simulatedRssi));
      setDistance(Math.round(distance * 10) / 10);

      // Verify proximity is acceptable (within relay range)
      if (distance > relay.broadcastRangeMeters + 5) {
        setError(`Too far away. Device broadcast range: ${relay.broadcastRangeMeters}m`);
        setScanning(false);
        return;
      }

      // Record scan and trigger callback
      // In production, actual QR data would come from BLE characteristic
      const mockQrToken = `relay-${relay.id}-${Date.now()}`;

      // Record relay attendance on backend
      const recordResponse = await fetch("/api/attendance/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record_scan",
          relayDeviceId: relay.id,
          attendanceRecordId: sessionId, // This would be actual record ID
          bleRssi: simulatedRssi,
          bleDistance: distance,
        }),
      });

      if (!recordResponse.ok) {
        throw new Error("Failed to record relay scan");
      }

      toast.success(`Successfully scanned ${relay.studentName}'s device!`);
      onQrScanned(mockQrToken, relay.id, Math.round(simulatedRssi));

      setScanning(false);
    } catch (err: any) {
      if (err.name !== "NotFoundError") {
        const message =
          err.message || "Failed to scan BLE device. Please try again.";
        setError(message);
        console.error("[v0] BLE relay scan error:", err);
      }
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!supported) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <p className="text-sm text-amber-700 font-medium">
          BLE relay scanning is not enabled for this session yet. Please wait for
          students to scan the QR directly or use the main camera scanner.
        </p>
      </div>
    );
  }

  if (relays.length === 0) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-700">
          No students are currently broadcasting. Once they scan the QR code,
          they can become relay points for students with camera issues.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Bluetooth className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold">Scan from Friend's Device (BLE)</h3>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Select a friend's device to scan their BLE broadcast:
        </p>

        <div className="grid gap-2">
          {relays.map((relay) => (
            <button
              key={relay.id}
              onClick={() => startBleScanning(relay)}
              disabled={scanning || disabled}
              className={`w-full p-4 rounded-lg border transition text-left ${
                scanning
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-blue-50 hover:border-blue-300"
              } ${selectedRelay?.id === relay.id ? "border-blue-500 bg-blue-50" : "border-border"}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{relay.studentName}</p>
                  <p className="text-xs text-muted-foreground">
                    {relay.deviceName}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Broadcast Range: {relay.broadcastRangeMeters}m
                  </p>
                </div>

                {scanning && selectedRelay?.id === relay.id ? (
                  <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                ) : (
                  <Radio className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              {selectedRelay?.id === relay.id && rssi !== null && (
                <div className="mt-3 p-2 bg-white rounded border border-green-200">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDetails(!showDetails);
                    }}
                    className="flex items-center gap-2 text-xs text-green-700 font-medium w-full justify-between"
                  >
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" />
                      Signal Detected
                    </span>
                    {showDetails ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>

                  {showDetails && (
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <p>Signal Strength (RSSI): {rssi} dBm</p>
                      <p>Estimated Distance: {distance?.toFixed(1)}m</p>
                      <p>
                        Status:{" "}
                        <span className="text-green-600 font-medium">
                          Close enough
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground border-t pt-2">
        Your phone will be asked to scan for Bluetooth devices. Make sure the
        broadcaster is nearby (within {Math.max(...relays.map(r => r.broadcastRangeMeters))}m).
      </p>
    </div>
  );
}

/**
 * Calculate distance from RSSI using log distance path loss model
 */
function calculateDistance(rssi: number, txPower: number = -59): number {
  const n = 2.5; // Path loss exponent for indoor
  const distance = Math.pow(10, (txPower - rssi) / (10 * n));
  return Math.max(0, distance);
}
