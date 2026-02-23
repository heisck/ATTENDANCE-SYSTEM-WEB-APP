"use client";

import { useEffect, useState } from "react";
import { Bluetooth, AlertTriangle, CheckCircle2 } from "lucide-react";

export function BleProximityCheck() {
  const [supported, setSupported] = useState(false);
  const [secureContext, setSecureContext] = useState(false);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && Boolean((navigator as any).bluetooth));
    setSecureContext(typeof window !== "undefined" ? window.isSecureContext : false);
  }, []);

  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs">
      <div className="flex items-center gap-2 font-medium">
        <Bluetooth className="h-4 w-4" />
        BLE Proximity Check (Experimental)
      </div>
      <div className="mt-2 space-y-1 text-muted-foreground">
        <p className="flex items-center gap-1">
          {supported ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          )}
          Web Bluetooth support: {supported ? "Available" : "Unavailable"}
        </p>
        <p className="flex items-center gap-1">
          {secureContext ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          )}
          Secure context (HTTPS): {secureContext ? "Yes" : "No"}
        </p>
        <p>
          Attendance validation still relies on passkey + GPS + rotating QR + IP, because BLE web
          support is inconsistent across browsers/devices.
        </p>
      </div>
    </div>
  );
}
