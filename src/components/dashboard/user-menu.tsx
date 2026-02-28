"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, LogOut, Monitor, Moon, Sun, UserCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type UserMenuProps = {
  role: string;
  userName: string;
  userEmail?: string | null;
  profileHref?: string;
  canSwitchHubs?: boolean;
  studentHubEnabled?: boolean;
  hubMode?: "attendance" | "studentHub";
  onHubModeChange?: (mode: "attendance" | "studentHub") => void;
};

function roleLabel(role: string) {
  return role.toLowerCase().replace(/_/g, " ");
}

function initialsOf(value: string) {
  const clean = value.trim();
  if (!clean) return "U";
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

type ThemeChoice = "light" | "dark" | "system";

export function UserMenu({
  role,
  userName,
  userEmail,
  profileHref,
  canSwitchHubs = false,
  studentHubEnabled = false,
  hubMode = "attendance",
  onHubModeChange,
}: UserMenuProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const roleText = useMemo(() => roleLabel(role), [role]);
  const initials = useMemo(() => initialsOf(userName), [userName]);

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

  const selectTheme = (value: ThemeChoice) => {
    setTheme(value);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-1.5 py-1 pr-2 text-left transition-colors hover:bg-muted/60"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-muted text-xs font-semibold text-foreground">
          {initials}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-[9rem] truncate text-xs font-medium text-foreground">{userName}</span>
          {role !== "STUDENT" ? (
            <span className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{roleText}</span>
          ) : null}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium text-popover-foreground">{userName}</p>
            {userEmail && <p className="truncate text-xs text-muted-foreground">{userEmail}</p>}
          </div>

          {profileHref && (
            <Link
              href={profileHref}
              prefetch
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
            >
              <UserCircle2 className="h-4 w-4 text-muted-foreground" />
              Profile
            </Link>
          )}

          {role === "STUDENT" && canSwitchHubs && onHubModeChange ? (
            <div className="border-t border-border px-3 py-2">
              <p className="pb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Hub</p>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onHubModeChange("attendance");
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-xs font-medium",
                    hubMode === "attendance"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  Attendance
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!studentHubEnabled) return;
                    onHubModeChange("studentHub");
                    setOpen(false);
                  }}
                  disabled={!studentHubEnabled}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-xs font-medium",
                    hubMode === "studentHub"
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent",
                    !studentHubEnabled && "cursor-not-allowed opacity-50 hover:bg-transparent"
                  )}
                >
                  Student
                </button>
              </div>
              {!studentHubEnabled ? (
                <p className="pt-1 text-[10px] text-muted-foreground">
                  Student Hub disabled for your organization.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="border-t border-border px-2 py-2">
            <p className="px-2 pb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Theme</p>
            <button
              type="button"
              onClick={() => selectTheme("light")}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <span className="inline-flex items-center gap-2">
                <Sun className="h-4 w-4 text-muted-foreground" />
                Light
              </span>
              {theme === "light" && <Check className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => selectTheme("dark")}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <span className="inline-flex items-center gap-2">
                <Moon className="h-4 w-4 text-muted-foreground" />
                Dark
              </span>
              {theme === "dark" && <Check className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => selectTheme("system")}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <span className="inline-flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                System
              </span>
              {theme === "system" && <Check className="h-4 w-4" />}
            </button>
          </div>

          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

