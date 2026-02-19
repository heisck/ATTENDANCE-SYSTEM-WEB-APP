"use client";

import { useState, useEffect } from "react";
import { Loader2, Smartphone, Laptop, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useSession } from "next-auth/react";

interface Device {
  id: string;
  credentialId: string;
  deviceType: string;
  userAgent: string;
  transports: string[];
  backedUp: boolean;
  registeredAt: string;
}

export default function DevicesPage() {
  const { data: session } = useSession();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchDevices();
  }, []);

  async function fetchDevices() {
    try {
      setLoading(true);
      const res = await fetch("/api/webauthn/devices");
      if (!res.ok) throw new Error("Failed to fetch devices");
      const data = await res.json();
      setDevices(data.devices);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteDevice(credentialId: string) {
    if (devices.length === 1) {
      alert("You must have at least one device registered. If you already removed this passkey from your device password/passkey manager, contact your administrator to reset your passkeys.");
      return;
    }

    if (!confirm("Delete this passkey? You won't be able to use it for attendance.")) {
      return;
    }

    try {
      setDeletingId(credentialId);
      const res = await fetch(`/api/webauthn/devices/${credentialId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete device");
      }

      setDevices(devices.filter(d => d.credentialId !== credentialId));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  const getDeviceIcon = (userAgent: string) => {
    if (userAgent.includes("iPhone") || userAgent.includes("iOS")) {
      return <Smartphone className="h-5 w-5" />;
    } else if (userAgent.includes("Android")) {
      return <Smartphone className="h-5 w-5" />;
    } else {
      return <Laptop className="h-5 w-5" />;
    }
  };

  const getDeviceName = (userAgent: string) => {
    if (userAgent.includes("iPhone")) return "iPhone";
    if (userAgent.includes("iPad")) return "iPad";
    if (userAgent.includes("Android")) return "Android Device";
    if (userAgent.includes("Windows")) return "Windows PC";
    if (userAgent.includes("Mac")) return "Mac";
    return "Device";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Registered Devices</h1>
        <p className="text-muted-foreground">
          Manage the devices and passkeys used for attendance verification
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">No devices registered yet.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Go to <strong>Register Device</strong> to create your first passkey.
          </p>
          <a
            href="/setup-device"
            className="inline-flex mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Register Device
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <div
              key={device.credentialId}
              className="rounded-lg border border-border bg-card p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="rounded-full bg-primary/10 p-3">
                  {getDeviceIcon(device.userAgent)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{getDeviceName(device.userAgent)}</p>
                    {device.backedUp && (
                      <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        Cloud Synced
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {device.userAgent}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Registered {new Date(device.registeredAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {devices.length === 1 ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted text-muted-foreground text-xs">
                    <CheckCircle2 className="h-4 w-4" />
                    Only Device
                  </div>
                ) : (
                  <button
                    onClick={() => handleDeleteDevice(device.credentialId)}
                    disabled={deletingId === device.credentialId}
                    title="Delete this passkey"
                    className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                  >
                    {deletingId === device.credentialId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="font-semibold">Important Security Information</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-medium text-foreground">•</span>
            <span>Each device can only have one passkey per account</span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">•</span>
            <span>Deleting a passkey prevents that device from marking attendance</span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">•</span>
            <span>You must always have at least one active device</span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">•</span>
            <span>If you remove a passkey outside this page, contact your administrator to reset passkeys</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
