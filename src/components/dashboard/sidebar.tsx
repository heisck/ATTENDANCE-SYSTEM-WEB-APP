"use client";

import { useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import Dock, { type DockItemData } from "@/components/Dock";
import { UserMenu } from "@/components/dashboard/user-menu";
import {
  BarChart3,
  BookOpen,
  Building2,
  FileText,
  Fingerprint,
  History,
  Home,
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

function roleLabel(role: string) {
  return role.toLowerCase().replace(/_/g, " ");
}

function formatSegment(segment: string) {
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveCurrentPage(pathname: string, rolePath: string, items: NavItem[]) {
  if (pathname === rolePath) return "Dashboard";

  const activeItem = items.find((item) => isRouteActive(pathname, item.href, rolePath));
  if (activeItem) return activeItem.label;

  const relativePath = pathname.replace(`${rolePath}/`, "");
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length === 0) return "Dashboard";

  const last = segments[segments.length - 1];
  const isIdLike = /^[a-f0-9-]{8,}$/i.test(last) || /^\d+$/.test(last);
  if (isIdLike && segments.length > 1) {
    return `${formatSegment(segments[segments.length - 2])} Details`;
  }

  return formatSegment(last);
}

function profileHrefByRole(role: string) {
  switch (role) {
    case "STUDENT":
      return "/student/profile";
    case "ADMIN":
      return "/admin/settings";
    case "LECTURER":
      return "/lecturer";
    case "SUPER_ADMIN":
      return "/super-admin";
    default:
      return undefined;
  }
}

export function Sidebar({
  role,
  userName,
  userEmail,
}: {
  role: string;
  userName: string;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navByRole[role] || [];
  const rolePath = `/${role.toLowerCase().replace(/_/g, "-")}`;
  const currentPage = useMemo(() => deriveCurrentPage(pathname, rolePath, items), [items, pathname, rolePath]);
  const profileHref = useMemo(() => profileHrefByRole(role), [role]);

  const dockItems = useMemo<DockItemData[]>(
    () =>
      items.map((item) => {
        const Icon = item.icon;
        const isActive = isRouteActive(pathname, item.href, rolePath);

        return {
          icon: (
            <Icon
              size={17}
              className={isActive ? "text-black dark:text-gray-100" : "text-black/90 dark:text-gray-400"}
            />
          ),
          label: item.label,
          onClick: () => router.push(item.href),
          className: isActive
            ? "!border-gray-300/80 !bg-gray-200/75 dark:!border-gray-500/70 dark:!bg-gray-700/45"
            : "",
        };
      }),
    [items, pathname, rolePath, router]
  );

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-border/70 bg-background/90 px-3 sm:px-4 lg:px-6 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={rolePath} className="flex items-center gap-2.5">
            <Image src="/web-app-manifest-192x192.png" alt="App logo" width={28} height={28} className="rounded logo-mark" />
          </Link>
          <span className="hidden h-6 w-px bg-border/70 sm:block" />
          <div className="hidden min-w-0 sm:block">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{roleLabel(role)}</p>
            <p className="truncate text-sm font-medium text-foreground">{currentPage}</p>
          </div>
        </div>
        <UserMenu role={role} userName={userName} userEmail={userEmail} profileHref={profileHref} />
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
