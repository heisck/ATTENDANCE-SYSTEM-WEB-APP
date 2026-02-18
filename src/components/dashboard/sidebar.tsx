"use client";

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
    { label: "My Device", href: "/setup-device", icon: <Fingerprint className="h-4 w-4" /> },
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

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-card">
      <div className="flex h-16 items-center gap-2 border-b border-border px-6">
        <Shield className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold">AttendanceIQ</span>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {items.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== `/${role.toLowerCase().replace("_", "-")}` &&
              pathname.startsWith(item.href));

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
          <p className="text-sm font-medium truncate">{userName}</p>
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
  );
}
