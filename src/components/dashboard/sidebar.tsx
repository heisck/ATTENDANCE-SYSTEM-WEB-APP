"use client";

import { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import type { LucideIcon } from "lucide-react";
import Dock, { type DockItemData } from "@/components/Dock";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import {
  BarChart3,
  BookOpen,
  Building2,
  FileText,
  Fingerprint,
  History,
  Home,
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
    { label: "Dashboard", href: "/student", icon: Home },
    { label: "Mark Attendance", href: "/student/attend", icon: QrCode },
    { label: "History", href: "/student/history", icon: History },
    { label: "Devices", href: "/student/devices", icon: Fingerprint },
    { label: "Profile", href: "/student/profile", icon: User },
  ],
  LECTURER: [
    { label: "Dashboard", href: "/lecturer", icon: Home },
    { label: "Courses", href: "/lecturer/courses", icon: BookOpen },
    { label: "New Session", href: "/lecturer/session/new", icon: Play },
    { label: "Reports", href: "/lecturer/reports", icon: FileText },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/admin", icon: Home },
    { label: "Users", href: "/admin/users", icon: Users },
    { label: "Lecturer Invites", href: "/admin/lecturer-invites", icon: UserPlus },
    { label: "Courses", href: "/admin/courses", icon: BookOpen },
    { label: "Passkey Management", href: "/admin/passkeys", icon: Fingerprint },
    { label: "Settings", href: "/admin/settings", icon: Settings },
  ],
  SUPER_ADMIN: [
    { label: "Dashboard", href: "/super-admin", icon: Home },
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
          icon: (
            <Icon
              size={17}
              className={isActive ? "text-black dark:text-gray-100" : "text-black dark:text-gray-400"}
            />
          ),
          label: item.label,
          onClick: () => router.push(item.href),
          className: isActive
            ? "border-gray-300/80 bg-white/90 dark:border-gray-500/70 dark:bg-gray-700/45"
            : "",
        };
      }),
    [items, pathname, rolePath, router]
  );

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <Link href={rolePath} className="flex items-center gap-2">
          <Image src="/web-app-manifest-192x192.png" alt="attendanceIQ" width={24} height={24} className="rounded" />
          <span className="text-base font-bold font-[family-name:var(--font-silkscreen)] tracking-tight">
            attendanceIQ
          </span>
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
      </header>

      {dockItems.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className="pointer-events-auto relative mx-auto h-[88px] w-full sm:h-[92px]">
            <Dock
              items={dockItems}
              panelHeight={60}
              baseItemSize={40}
              magnification={62}
              distance={140}
              className="max-w-[calc(100vw-0.75rem)] !gap-2 !px-2 sm:max-w-[min(90vw,980px)] sm:!gap-3 sm:!px-3"
            />
          </div>
        </div>
      )}
    </>
  );
}
