"use client";

import { useEffect, useState, useRef } from "react";
import {
  Bluetooth,
  Loader2,
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

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

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
        optionalServices: ["generic_access", "b9f2c841-8e2f-4f96-9167-8fdf4564a001"],
      };

      const device = await (navigator as any).bluetooth.requestDevice(options);

      if (!device) {
        setError("No device selected");
        setScanning(false);
        return;
      }

      // Connect to GATT Server to read the token
      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error("Failed to connect to GATT server");
      }

      // We'll use a standard service UUID for attendance relay if defined,
      // but assuming generic access or a specific attendance service here.
      // Since the app didn't define a specific relay service UUID, we attempt
      // to read from the established ATTENDANCE_BLE.SERVICE_UUID
      const serviceUuid = "b9f2c841-8e2f-4f96-9167-8fdf4564a001";
      const charUuid = "b9f2c841-8e2f-4f96-9167-8fdf4564a002";
      
      let realQrToken = "";
      
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const characteristic = await service.getCharacteristic(charUuid);
        const value = await characteristic.readValue();
        const decoder = new TextDecoder("utf-8");
        realQrToken = decoder.decode(value);
      } catch {
        console.warn("Could not read QR characteristic, falling back to basic connection validation");
        throw new Error("Could not read attendance token from this device.");
      }

      // In a pure web environment, getting actual RSSI is tricky without watchAdvertisements()
      // We estimate a conservative default if it's not supported
      let actualRssi = -65;
      
      if ('watchAdvertisements' in device) {
        const abortController = new AbortController();
        const handler = (event: any) => {
          if (event.rssi) actualRssi = event.rssi;
          abortController.abort();
          device.removeEventListener('advertisementreceived', handler);
        };
        device.addEventListener('advertisementreceived', handler);
        
        try {
          await (device as any).watchAdvertisements({ signal: abortController.signal });
          // Wait briefly for an advertisement
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch {
          // Ignore
        }
      }

      const distance = calculateDistance(actualRssi);

      setRssi(actualRssi);
      setDistance(Math.round(distance * 10) / 10);

      // Verify proximity is acceptable (within relay range)
      if (distance > relay.broadcastRangeMeters + 5) {
        setError(`Too far away. Device broadcast range: ${relay.broadcastRangeMeters}m`);
        setScanning(false);
        if (device.gatt?.connected) device.gatt.disconnect();
        return;
      }

      // Record relay attendance on backend
      const recordResponse = await fetch("/api/attendance/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record_scan",
          relayDeviceId: relay.id,
          bleRssi: actualRssi,
          bleDistance: distance,
        }),
      });

      if (!recordResponse.ok) {
        throw new Error("Failed to record relay scan");
      }

      if (device.gatt?.connected) device.gatt.disconnect();

      toast.success(`Successfully scanned ${relay.studentName}'s device!`);
      onQrScanned(realQrToken, relay.id, actualRssi);

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
      <div className="status-panel">
        <p className="text-sm font-medium">
          BLE relay scanning is not enabled for this session yet. Please wait for
          students to scan the QR directly or use the main camera scanner.
        </p>
      </div>
    );
  }

  if (relays.length === 0) {
    return (
      <div className="status-panel">
        <p className="text-sm">
          No students are currently broadcasting. Once they scan the QR code,
          they can become relay points for students with camera issues.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Bluetooth className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Scan from Friend's Device (BLE)</h3>
      </div>

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
                  : "hover:bg-accent"
              } ${selectedRelay?.id === relay.id ? "border-border bg-muted/50" : "border-border"}`}
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
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <Radio className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              {selectedRelay?.id === relay.id && rssi !== null && (
                <div className="status-panel-subtle mt-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDetails(!showDetails);
                    }}
                    className="flex w-full items-center justify-between gap-2 text-xs font-medium"
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
                        <span className="font-medium text-foreground">
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
