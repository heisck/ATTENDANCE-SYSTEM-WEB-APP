"use client";

import { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import type { LucideIcon } from "lucide-react";
import Dock, { type DockItemData } from "@/components/Dock";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  BarChart3,
  BookOpen,
  Building2,
  FileText,
  Fingerprint,
  History,
  LayoutDashboard,
  LogOut,
  Play,
  QrCode,
  Settings,
  User,
  UserPlus,
  Users,
} from "lucide-react";


interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const navByRole: Record<string, NavItem[]> = {
  STUDENT: [
    { label: "Dashboard", href: "/student", icon: LayoutDashboard },
    { label: "Mark Attendance", href: "/student/attend", icon: QrCode },
    { label: "History", href: "/student/history", icon: History },
    { label: "Devices", href: "/student/devices", icon: Fingerprint },
    { label: "Profile", href: "/student/profile", icon: User },
  ],
  LECTURER: [
    { label: "Dashboard", href: "/lecturer", icon: LayoutDashboard },
    { label: "Courses", href: "/lecturer/courses", icon: BookOpen },
    { label: "New Session", href: "/lecturer/session/new", icon: Play },
    { label: "Reports", href: "/lecturer/reports", icon: FileText },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
    { label: "Users", href: "/admin/users", icon: Users },
    { label: "Lecturer Invites", href: "/admin/lecturer-invites", icon: UserPlus },
    { label: "Courses", href: "/admin/courses", icon: BookOpen },
    { label: "Passkey Management", href: "/admin/passkeys", icon: Fingerprint },
    { label: "Settings", href: "/admin/settings", icon: Settings },
  ],
  SUPER_ADMIN: [
    { label: "Dashboard", href: "/super-admin", icon: LayoutDashboard },
    { label: "Organizations", href: "/super-admin/organizations", icon: Building2 },
    { label: "Analytics", href: "/super-admin/analytics", icon: BarChart3 },
  ],
};

function isRouteActive(pathname: string, href: string, rolePath: string) {
  return pathname === href || (href !== rolePath && pathname.startsWith(href));
}

export function Sidebar({ role, userName }: { role: string; userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navByRole[role] || [];
  const rolePath = `/${role.toLowerCase().replace(/_/g, "-")}`;

  const dockItems = useMemo<DockItemData[]>(
    () =>
      items.map((item) => {
        const Icon = item.icon;
        const isActive = isRouteActive(pathname, item.href, rolePath);

        return {
          icon: <Icon size={18} className={isActive ? "text-cyan-300" : "text-white"} />,
          label: item.label,
          onClick: () => router.push(item.href),
          className: isActive ? "border-cyan-300/70" : "",
        };
      }),
    [items, pathname, rolePath, router]
  );

  return (
    <>
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <Link href={rolePath} className="flex items-center gap-2">
          <Image src="/web-app-manifest-192x192.png" alt="attendanceIQ" width={24} height={24} className="rounded" />
          <span className="text-base font-bold font-[family-name:var(--font-silkscreen)] tracking-tight">attendanceIQ</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <aside className="hidden h-svh w-64 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-border px-6">
          <Image src="/web-app-manifest-192x192.png" alt="attendanceIQ" width={28} height={28} className="rounded" />
          <span className="text-lg font-bold font-[family-name:var(--font-silkscreen)] tracking-tight">attendanceIQ</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = isRouteActive(pathname, item.href, rolePath);

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
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="mb-3 px-3">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {role.toLowerCase().replace(/_/g, " ")}
            </p>
          </div>
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-sm font-medium">Theme</span>
            <ThemeToggle />
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

      {dockItems.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 md:hidden">
          <div className="pointer-events-auto relative h-[84px] w-full">
            <Dock
              items={dockItems}
              panelHeight={68}
              baseItemSize={46}
              magnification={70}
              className="max-w-[calc(100vw-0.75rem)] overflow-x-auto bg-[#060010]/90 backdrop-blur supports-[backdrop-filter]:bg-[#060010]/80 !gap-2 !px-2"
            />
          </div>
        </div>
      )}
    </>
  );
}
