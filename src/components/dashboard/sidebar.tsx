"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  Shield,
  LayoutDashboard,
  QrCode,
  History,
  Users,
  BookOpen,
  Settings,
  LogOut,
  BarChart3,
  Building2,
  Play,
  FileText,
  Fingerprint,
  Menu,
  X,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const navByRole: Record<string, NavItem[]> = {
  STUDENT: [
    { label: "Dashboard", href: "/student", icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: "Mark Attendance", href: "/student/attend", icon: <QrCode className="h-4 w-4" /> },
    { label: "History", href: "/student/history", icon: <History className="h-4 w-4" /> },
    { label: "Devices", href: "/student/devices", icon: <Fingerprint className="h-4 w-4" /> },
  ],
  LECTURER: [
    { label: "Dashboard", href: "/lecturer", icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: "New Session", href: "/lecturer/session/new", icon: <Play className="h-4 w-4" /> },
    { label: "Reports", href: "/lecturer/reports", icon: <FileText className="h-4 w-4" /> },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/admin", icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: "Users", href: "/admin/users", icon: <Users className="h-4 w-4" /> },
    { label: "Courses", href: "/admin/courses", icon: <BookOpen className="h-4 w-4" /> },
    { label: "Passkey Management", href: "/admin/passkeys", icon: <Fingerprint className="h-4 w-4" /> },
    { label: "Settings", href: "/admin/settings", icon: <Settings className="h-4 w-4" /> },
  ],
  SUPER_ADMIN: [
    { label: "Dashboard", href: "/super-admin", icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: "Organizations", href: "/super-admin/organizations", icon: <Building2 className="h-4 w-4" /> },
    { label: "Analytics", href: "/super-admin/analytics", icon: <BarChart3 className="h-4 w-4" /> },
  ],
};

export function Sidebar({ role, userName }: { role: string; userName: string }) {
  const pathname = usePathname();
  const items = navByRole[role] || [];
  const rolePath = `/${role.toLowerCase().replace("_", "-")}`;
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <Link href={rolePath} className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <span className="text-base font-bold">AttendanceIQ</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-accent transition-colors"
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setMobileOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        aria-hidden={!mobileOpen}
        tabIndex={-1}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card transition-transform duration-200 md:static md:z-auto md:h-svh md:w-64 md:max-w-none md:shrink-0 md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-6">
          <Shield className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold">AttendanceIQ</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {items.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== rolePath && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="mb-3 px-3">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {role.toLowerCase().replace("_", " ")}
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
