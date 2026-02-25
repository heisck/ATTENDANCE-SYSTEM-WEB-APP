"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

function base64UrlToUint8Array(base64UrlString: string) {
  const padding = "=".repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function PushNotificationToggle() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const publicKey = useMemo(() => process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || "", []);

  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(isSupported);
    if (!isSupported) return;

    setPermission(Notification.permission);
    void (async () => {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      setSubscribed(Boolean(subscription));
    })();
  }, []);

  async function enablePush() {
    if (!supported) return;
    setLoading(true);

    try {
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);
      if (permissionResult !== "granted") {
        throw new Error("Notification permission was denied.");
      }
      if (!publicKey) {
        throw new Error("Missing NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY");
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });

      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save push subscription");
      }
      setSubscribed(true);
      toast.success("Push notifications enabled.");
    } catch (err: any) {
      toast.error(err.message || "Unable to enable notifications");
    } finally {
      setLoading(false);
    }
  }

  async function disablePush() {
    if (!supported) return;
    setLoading(true);

    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;
      if (subscription) {
        await subscription.unsubscribe();
      }

      if (endpoint) {
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }

      setSubscribed(false);
      toast.success("Push notifications disabled.");
    } catch (err: any) {
      toast.error(err.message || "Unable to disable notifications");
    } finally {
      setLoading(false);
    }
  }

  if (!supported) {
    return (
      <div className="surface p-3 text-xs text-muted-foreground">
        Push notifications are not supported by this browser.
      </div>
    );
  }

  return (
    <div className="surface space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Attendance Push Notifications</p>
        <span className="text-xs text-muted-foreground">Permission: {permission}</span>
      </div>

      {!subscribed ? (
        <button
          type="button"
          onClick={enablePush}
          disabled={loading}
          className="inline-flex w-full items-center justify-start gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:w-auto sm:justify-center"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
          Enable Push
        </button>
      ) : (
        <button
          type="button"
          onClick={disablePush}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellOff className="h-3.5 w-3.5" />}
          Disable Push
        </button>
      )}
    </div>
  );
}
