"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BellRing, Ellipsis, Fingerprint, Loader2, Play, QrCode } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type QuickActionsMenuProps = {
  role: string;
};

function base64UrlToUint8Array(base64UrlString: string) {
  const padding = "=".repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) {
    return existing;
  }

  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

export function QuickActionsMenu({ role }: QuickActionsMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const publicKey = useMemo(() => process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || "", []);

  const hasMenu = role === "STUDENT" || role === "LECTURER";
  const isStudentAttendancePage = role === "STUDENT" && pathname.startsWith("/student/attend");
  const title = useMemo(() => {
    if (role === "STUDENT") return "Student Actions";
    if (role === "LECTURER") return "Lecturer Actions";
    return "";
  }, [role]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (role !== "STUDENT") return;
    const isSupported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setPushSupported(isSupported);
    if (!isSupported) return;

    void (async () => {
      try {
        const registration = await getPushRegistration();
        const subscription = await registration.pushManager.getSubscription();
        setPushSubscribed(Boolean(subscription));
      } catch {
        setPushSubscribed(false);
      }
    })();
  }, [role]);

  if (!hasMenu) return null;

  const openRoute = (href: string) => {
    setOpen(false);
    if (pathname === href) return;
    router.push(href);
  };

  const enableNotification = async () => {
    if (enablingPush || role !== "STUDENT") return;
    if (!pushSupported) {
      toast.error("Push notifications are not supported by this browser.");
      return;
    }
    if (pushSubscribed) {
      toast.success("Notifications already enabled.");
      setOpen(false);
      return;
    }

    setEnablingPush(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was denied.");
      }
      if (!publicKey) {
        throw new Error("Missing NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY");
      }

      const registration = await getPushRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey),
        });
      }

      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save push subscription");
      }

      setPushSubscribed(true);
      setOpen(false);
      toast.success("Notifications enabled.");
    } catch (error: any) {
      toast.error(error?.message || "Unable to enable notifications");
    } finally {
      setEnablingPush(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/70 transition-colors hover:bg-muted/60",
          open && "bg-muted/70"
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Quick actions"
      >
        <Ellipsis className="h-5 w-5 text-foreground/90" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        >
          <p className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </p>

          {role === "STUDENT" ? (
            <>
              {isStudentAttendancePage ? (
                <>
                  <button
                    type="button"
                    onClick={() => openRoute("/student/attend?mode=scan")}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  >
                    <QrCode className="h-4 w-4 text-muted-foreground" />
                    Scan Nearby Devices
                  </button>
                  <button
                    type="button"
                    onClick={() => openRoute("/student/attend?mode=verify")}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  >
                    <Fingerprint className="h-4 w-4 text-muted-foreground" />
                    Verify Passkey
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => openRoute("/student/attend")}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  >
                    <QrCode className="h-4 w-4 text-muted-foreground" />
                    Mark Attendance
                  </button>
                  <button
                    type="button"
                    onClick={() => void enableNotification()}
                    disabled={enablingPush}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent",
                      enablingPush && "cursor-not-allowed opacity-70"
                    )}
                  >
                    {enablingPush ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : pushSubscribed ? (
                      <BellRing className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Bell className="h-4 w-4 text-muted-foreground" />
                    )}
                    {pushSubscribed ? "Notifications Enabled" : "Enable Notification"}
                  </button>
                </>
              )}
            </>
          ) : null}

          {role === "LECTURER" ? (
            <button
              type="button"
              onClick={() => openRoute("/lecturer/session/new")}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
            >
              <Play className="h-4 w-4 text-muted-foreground" />
              Start Session
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
