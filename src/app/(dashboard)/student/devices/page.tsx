"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Smartphone, Laptop, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";

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
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [passkeysLockedUntilAdminReset, setPasskeysLockedUntilAdminReset] = useState(false);
  const canRegisterNewPasskey =
    !loading && !passkeysLockedUntilAdminReset && devices.length === 0;

  useEffect(() => {
    fetchDevices();
  }, []);

  async function fetchDevices() {
    try {
      setLoading(true);
      const statusRes = await fetch("/api/auth/student-status");
      if (statusRes.ok) {
        const status = await statusRes.json();
        if (status.requiresProfileCompletion || !status.personalEmailVerified) {
          router.push("/student/complete-profile");
          return;
        }
        if (!status.hasPasskey) {
          router.push("/setup-device");
          return;
        }
      }

      const res = await fetch("/api/webauthn/devices");
      if (!res.ok) throw new Error("Failed to fetch devices");
      const data = await res.json();
      setDevices(data.devices || []);
      setPasskeysLockedUntilAdminReset(Boolean(data.passkeysLockedUntilAdminReset));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteDevice(credentialId: string) {
    if (passkeysLockedUntilAdminReset) {
      setError("Passkeys are locked. Ask your administrator to unlock before deleting.");
      return;
    }

    const isOnlyDevice = devices.length === 1;
    const confirmMessage = isOnlyDevice
      ? "Delete your only passkey? You must register a new passkey before you can mark attendance again."
      : "Delete this passkey? You won't be able to use it for attendance.";

    if (!confirm(confirmMessage)) {
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

      setDevices((current) =>
        current.filter((d) => d.credentialId !== credentialId)
      );
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Registered Devices</h1>
          <p className="text-muted-foreground">
            Manage the devices and passkeys used for attendance verification
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/setup-device")}
          disabled={!canRegisterNewPasskey}
          title={
            loading
              ? "Loading passkey state"
              : passkeysLockedUntilAdminReset
              ? "Ask admin to unlock passkeys first"
              : "Delete your current passkey before registering a new one"
          }
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40 transition-colors"
        >
          Register New Passkey
        </button>
      </div>

      {passkeysLockedUntilAdminReset && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          Passkey management is locked. Ask your administrator to unlock your account before deleting or adding a new passkey.
        </div>
      )}

      {!passkeysLockedUntilAdminReset && devices.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Delete your current passkey first. Registering a new passkey is only enabled when you have no active passkeys.
        </div>
      )}

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
          {passkeysLockedUntilAdminReset ? (
            <p className="mt-4 text-sm text-yellow-700">
              Registration is locked. Contact your administrator to unlock passkeys.
            </p>
          ) : (
            <Link
              href="/setup-device"
              className="inline-flex mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Register Device
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <div
              key={device.credentialId}
              className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-4">
                <div className="rounded-full bg-primary/10 p-3">
                  {getDeviceIcon(device.userAgent)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
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

              <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
                {devices.length === 1 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted text-muted-foreground text-xs">
                    <CheckCircle2 className="h-4 w-4" />
                    Only Device
                  </div>
                )}
                <button
                  onClick={() => handleDeleteDevice(device.credentialId)}
                  disabled={passkeysLockedUntilAdminReset || deletingId === device.credentialId}
                  title={
                    passkeysLockedUntilAdminReset
                      ? "Ask admin to unlock passkeys before deleting"
                      : "Delete this passkey"
                  }
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
                >
                  {deletingId === device.credentialId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Delete
                </button>
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
            <span>Deleting any passkey requires admin unlock first</span>
          </li>
          <li className="flex gap-2">
            <span className="font-medium text-foreground">•</span>
            <span>You can register a new passkey only after deleting existing passkeys</span>
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
