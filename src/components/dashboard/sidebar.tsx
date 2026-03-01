"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import Dock, { type DockItemData } from "@/components/Dock";
import { UserMenu } from "@/components/dashboard/user-menu";
import { QuickActionsMenu } from "@/components/dashboard/quick-actions-menu";
import {
  Bell,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardList,
  FileEdit,
  FileText,
  Fingerprint,
  GraduationCap,
  History,
  Home,
  LayoutList,
  Megaphone,
  Play,
  QrCode,
  Settings,
  User,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

type StudentNavFlags = {
  studentHubCore: boolean;
  courseRepTools: boolean;
  examHub: boolean;
  groupFormation: boolean;
  isCourseRep: boolean;
};

type StudentHubMode = "attendance" | "studentHub";
const STUDENT_HUB_UPDATES_READ_KEY = "student.hub.read.updates.signature";
const STUDENT_HUB_DEADLINES_READ_KEY = "student.hub.read.deadlines.signature";

const baseNavByRole: Record<string, NavItem[]> = {
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
    { label: "Profile", href: "/lecturer/profile", icon: User },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/admin", icon: Home },
    { label: "Users", href: "/admin/users", icon: Users },
    { label: "Lecturer Invites", href: "/admin/lecturer-invites", icon: UserPlus },
    { label: "Course Reps", href: "/admin/course-reps", icon: User },
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

const studentHubNav: NavItem[] = [
  { label: "Dashboard", href: "/student/hub/dashboard", icon: Home },
  { label: "Timetable", href: "/student/hub/timetable", icon: CalendarDays },
  { label: "Updates", href: "/student/hub/updates", icon: Bell },
  { label: "Deadlines", href: "/student/hub/deadlines", icon: ClipboardList },
];

const studentHubExamNav: NavItem = {
  label: "Exams",
  href: "/student/hub/exams",
  icon: GraduationCap,
};

const studentHubGroupNav: NavItem = {
  label: "Groups",
  href: "/student/hub/groups",
  icon: UsersRound,
};

const courseRepNav: NavItem[] = [
  { label: "Rep Timetable", href: "/student/rep/timetable", icon: LayoutList },
  { label: "Rep Updates", href: "/student/rep/updates", icon: Megaphone },
  { label: "Rep Assignments", href: "/student/rep/assignments", icon: FileEdit },
];

const courseRepExamNav: NavItem = {
  label: "Rep Exams",
  href: "/student/rep/exams",
  icon: GraduationCap,
};

const courseRepGroupNav: NavItem = {
  label: "Rep Groups",
  href: "/student/rep/groups",
  icon: UsersRound,
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
      return "/lecturer/profile";
    case "SUPER_ADMIN":
      return "/super-admin";
    default:
      return undefined;
  }
}

function compactCount(value: number) {
  if (value > 99) return "99+";
  return String(value);
}

function signatureFromIds(rows: Array<{ id?: unknown }>) {
  return rows
    .map((row) => {
      if (typeof row.id === "string") return row.id;
      if (typeof row.id === "number") return String(row.id);
      return "";
    })
    .filter((value) => value.length > 0)
    .join("|");
}

function readStoredSignature(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStoredSignature(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function StudentHubHeaderIndicators({
  updatesCount,
  deadlinesCount,
  updatesUnread,
  deadlinesUnread,
  onOpenUpdates,
  onOpenDeadlines,
}: {
  updatesCount: number;
  deadlinesCount: number;
  updatesUnread: boolean;
  deadlinesUnread: boolean;
  onOpenUpdates: () => void;
  onOpenDeadlines: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onOpenUpdates}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/70 transition-colors hover:bg-muted/60"
        aria-label={updatesUnread && updatesCount > 0 ? `Open updates (${updatesCount} unread)` : "Open updates"}
      >
        <Bell className="h-4.5 w-4.5 text-foreground/90" />
        {updatesUnread && updatesCount > 0 ? (
          <span className="absolute -top-1 -right-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {compactCount(updatesCount)}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={onOpenDeadlines}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/70 transition-colors hover:bg-muted/60"
        aria-label={
          deadlinesUnread && deadlinesCount > 0 ? `Open deadlines (${deadlinesCount} unread)` : "Open deadlines"
        }
      >
        <ClipboardList className="h-4.5 w-4.5 text-foreground/90" />
        {deadlinesUnread && deadlinesCount > 0 ? (
          <span className="absolute -top-1 -right-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-white">
            {compactCount(deadlinesCount)}
          </span>
        ) : null}
      </button>
    </div>
  );
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
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [studentHubMode, setStudentHubMode] = useState<StudentHubMode>("attendance");
  const [studentFlags, setStudentFlags] = useState<StudentNavFlags>({
    studentHubCore: false,
    courseRepTools: false,
    examHub: false,
    groupFormation: false,
    isCourseRep: false,
  });
  const [studentHubIndicators, setStudentHubIndicators] = useState({
    updatesCount: 0,
    deadlinesCount: 0,
    updatesSignature: "",
    deadlinesSignature: "",
    updatesUnread: false,
    deadlinesUnread: false,
  });
  const items = useMemo<NavItem[]>(() => {
    const base = baseNavByRole[role] || [];
    if (role !== "STUDENT") return base;

    const dashboard = base.find((item) => item.href === "/student");
    const attend = base.find((item) => item.href === "/student/attend");
    const history = base.find((item) => item.href === "/student/history");
    const devices = base.find((item) => item.href === "/student/devices");
    const profile = base.find((item) => item.href === "/student/profile");

    const attendanceHubItems: NavItem[] = [];
    if (dashboard) attendanceHubItems.push(dashboard);
    if (attend) attendanceHubItems.push(attend);
    if (history) attendanceHubItems.push(history);
    if (devices) attendanceHubItems.push(devices);
    if (profile) attendanceHubItems.push(profile);

    const studentHubItems: NavItem[] = [];
    if (studentFlags.studentHubCore) {
      studentHubItems.push(...studentHubNav);
      if (studentFlags.examHub) studentHubItems.push(studentHubExamNav);
      if (studentFlags.groupFormation) studentHubItems.push(studentHubGroupNav);

      if (studentFlags.courseRepTools && studentFlags.isCourseRep) {
        studentHubItems.push(...courseRepNav);
        if (studentFlags.examHub) studentHubItems.push(courseRepExamNav);
        if (studentFlags.groupFormation) studentHubItems.push(courseRepGroupNav);
      }
    }
    if (profile) {
      const hasProfile = studentHubItems.some((item) => item.href === profile.href);
      if (!hasProfile) studentHubItems.push(profile);
    }

    if (!studentFlags.studentHubCore) {
      return attendanceHubItems;
    }
    return studentHubMode === "studentHub" ? studentHubItems : attendanceHubItems;
  }, [
    role,
    studentFlags.courseRepTools,
    studentFlags.examHub,
    studentFlags.groupFormation,
    studentFlags.isCourseRep,
    studentFlags.studentHubCore,
    studentHubMode,
  ]);
  const rolePath = `/${role.toLowerCase().replace(/_/g, "-")}`;
  const currentPage = useMemo(() => deriveCurrentPage(pathname, rolePath, items), [items, pathname, rolePath]);
  const profileHref = useMemo(() => profileHrefByRole(role), [role]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 375px)");
    const syncCompactViewport = () => setIsCompactViewport(media.matches);
    syncCompactViewport();
    media.addEventListener("change", syncCompactViewport);
    return () => {
      media.removeEventListener("change", syncCompactViewport);
    };
  }, []);

  useEffect(() => {
    if (role !== "STUDENT") return;

    let cancelled = false;
    const syncStudentFlags = async () => {
      try {
        const response = await fetch("/api/auth/student-status", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;

        const featureFlags = data?.featureFlags || {};
        setStudentFlags({
          studentHubCore: Boolean(featureFlags.studentHubCore),
          courseRepTools: Boolean(featureFlags.courseRepTools),
          examHub: Boolean(featureFlags.examHub),
          groupFormation: Boolean(featureFlags.groupFormation),
          isCourseRep: Boolean(data?.isCourseRep),
        });
      } catch {
        if (!cancelled) {
          setStudentFlags((prev) => prev);
        }
      }
    };

    void syncStudentFlags();
    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => {
    if (role !== "STUDENT") return;

    const pathImpliesStudentHub = pathname.startsWith("/student/hub") || pathname.startsWith("/student/rep");
    const pathImpliesAttendanceHub =
      pathname === "/student" ||
      pathname.startsWith("/student/attend") ||
      pathname.startsWith("/student/history") ||
      pathname.startsWith("/student/devices");

    if (pathImpliesStudentHub) {
      setStudentHubMode("studentHub");
      try {
        localStorage.setItem("student.hub.mode", "studentHub");
      } catch {}
      return;
    }

    if (pathImpliesAttendanceHub) {
      setStudentHubMode("attendance");
      try {
        localStorage.setItem("student.hub.mode", "attendance");
      } catch {}
      return;
    }

    try {
      const saved = localStorage.getItem("student.hub.mode");
      if (saved === "attendance" || saved === "studentHub") {
        setStudentHubMode(saved);
      }
    } catch {}
  }, [pathname, role]);

  useEffect(() => {
    if (role !== "STUDENT" || !studentFlags.studentHubCore || studentHubMode !== "studentHub") {
      setStudentHubIndicators({
        updatesCount: 0,
        deadlinesCount: 0,
        updatesSignature: "",
        deadlinesSignature: "",
        updatesUnread: false,
        deadlinesUnread: false,
      });
      return;
    }

    let cancelled = false;
    const syncIndicators = async () => {
      try {
        const [updatesResponse, deadlinesResponse] = await Promise.all([
          fetch("/api/student/hub/class-updates?limit=25", { cache: "no-store" }),
          fetch("/api/student/hub/deadlines", { cache: "no-store" }),
        ]);

        if (cancelled) return;

        let updatesCount = 0;
        let deadlinesCount = 0;
        let updatesSignature = "";
        let deadlinesSignature = "";

        if (updatesResponse.ok) {
          const updatesPayload = await updatesResponse.json();
          const updatesRows = Array.isArray(updatesPayload?.updates)
            ? (updatesPayload.updates as Array<{ id?: unknown }>)
            : [];
          updatesCount = updatesRows.length;
          updatesSignature = signatureFromIds(updatesRows);
        }

        if (deadlinesResponse.ok) {
          const deadlinesPayload = await deadlinesResponse.json();
          const deadlinesRows = Array.isArray(deadlinesPayload?.deadlines)
            ? (deadlinesPayload.deadlines as Array<{ id?: unknown }>)
            : [];
          deadlinesCount = deadlinesRows.length;
          deadlinesSignature = signatureFromIds(deadlinesRows);
        }

        if (!cancelled) {
          const seenUpdates = readStoredSignature(STUDENT_HUB_UPDATES_READ_KEY);
          const seenDeadlines = readStoredSignature(STUDENT_HUB_DEADLINES_READ_KEY);
          setStudentHubIndicators({
            updatesCount,
            deadlinesCount,
            updatesSignature,
            deadlinesSignature,
            updatesUnread: updatesCount > 0 && updatesSignature.length > 0 && updatesSignature !== seenUpdates,
            deadlinesUnread: deadlinesCount > 0 && deadlinesSignature.length > 0 && deadlinesSignature !== seenDeadlines,
          });
        }
      } catch {
        if (!cancelled) {
          setStudentHubIndicators((prev) => prev);
        }
      }
    };

    void syncIndicators();
    const intervalId = setInterval(() => {
      void syncIndicators();
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [role, studentFlags.studentHubCore, studentHubMode]);

  useEffect(() => {
    if (role !== "STUDENT") return;

    if (pathname.startsWith("/student/hub/updates") && studentHubIndicators.updatesSignature.length > 0) {
      writeStoredSignature(STUDENT_HUB_UPDATES_READ_KEY, studentHubIndicators.updatesSignature);
      if (studentHubIndicators.updatesUnread) {
        setStudentHubIndicators((prev) => ({ ...prev, updatesUnread: false }));
      }
    }

    if (pathname.startsWith("/student/hub/deadlines") && studentHubIndicators.deadlinesSignature.length > 0) {
      writeStoredSignature(STUDENT_HUB_DEADLINES_READ_KEY, studentHubIndicators.deadlinesSignature);
      if (studentHubIndicators.deadlinesUnread) {
        setStudentHubIndicators((prev) => ({ ...prev, deadlinesUnread: false }));
      }
    }
  }, [
    pathname,
    role,
    studentHubIndicators.deadlinesSignature,
    studentHubIndicators.deadlinesUnread,
    studentHubIndicators.updatesSignature,
    studentHubIndicators.updatesUnread,
  ]);

  const openUpdatesFromIndicator = () => {
    if (studentHubIndicators.updatesSignature.length > 0) {
      writeStoredSignature(STUDENT_HUB_UPDATES_READ_KEY, studentHubIndicators.updatesSignature);
    }
    setStudentHubIndicators((prev) => ({ ...prev, updatesUnread: false }));
    router.push("/student/hub/updates");
  };

  const openDeadlinesFromIndicator = () => {
    if (studentHubIndicators.deadlinesSignature.length > 0) {
      writeStoredSignature(STUDENT_HUB_DEADLINES_READ_KEY, studentHubIndicators.deadlinesSignature);
    }
    setStudentHubIndicators((prev) => ({ ...prev, deadlinesUnread: false }));
    router.push("/student/hub/deadlines");
  };

  const handleHubSwitch = (nextMode: StudentHubMode) => {
    if (role !== "STUDENT") return;
    if (nextMode === studentHubMode) return;

    setStudentHubMode(nextMode);
    try {
      localStorage.setItem("student.hub.mode", nextMode);
    } catch {}

    if (nextMode === "attendance") {
      if (pathname.startsWith("/student/hub") || pathname.startsWith("/student/rep")) {
        router.push("/student");
      }
      return;
    }

    if (!studentFlags.studentHubCore) return;
    if (!(pathname.startsWith("/student/hub") || pathname.startsWith("/student/rep"))) {
      router.push("/student/hub/dashboard");
    }
  };

  useEffect(() => {
    const targets = new Set(items.map((item) => item.href));
    if (profileHref) targets.add(profileHref);

    targets.forEach((href) => {
      router.prefetch(href);
    });
  }, [items, profileHref, router]);

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
          onClick: () => {
            if (pathname === item.href) return;
            router.push(item.href);
          },
          className: isActive
            ? "!border-gray-300/80 !bg-gray-200/75 dark:!border-gray-500/70 dark:!bg-gray-700/45"
            : "",
        };
      }),
    [items, pathname, rolePath, router]
  );
  const hasDenseDock = isCompactViewport && dockItems.length >= 8;
  const dockPanelHeight = hasDenseDock ? 50 : isCompactViewport ? 54 : 60;
  const dockBaseItemSize = hasDenseDock ? 28 : isCompactViewport ? 32 : 40;
  const dockMagnification = hasDenseDock ? 40 : isCompactViewport ? 48 : 62;
  const dockDistance = hasDenseDock ? 90 : isCompactViewport ? 110 : 140;
  const dockOuterHeightClass = isCompactViewport ? "h-[80px]" : "h-[88px] sm:h-[92px]";
  const dockClassName = isCompactViewport
    ? "max-w-[calc(100vw-0.5rem)] !gap-1 !px-1.5"
    : "max-w-[calc(100vw-0.75rem)] !gap-2 !px-2 sm:max-w-[min(90vw,980px)] sm:!gap-3 sm:!px-3";

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-border/70 bg-background/90 px-3 sm:px-4 lg:px-6 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={rolePath} className="flex items-center gap-2.5">
            <Image src="/icon1.png" alt="App logo" width={28} height={28} className="rounded logo-mark" />
          </Link>
          <span className="hidden h-6 w-px bg-border/70 sm:block" />
          <div className="hidden min-w-0 sm:block">
            {role !== "STUDENT" ? (
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{roleLabel(role)}</p>
            ) : null}
            <p className="truncate text-sm font-medium text-foreground">{currentPage}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {role === "STUDENT" && studentFlags.studentHubCore && studentHubMode === "studentHub" ? (
            <StudentHubHeaderIndicators
              updatesCount={studentHubIndicators.updatesCount}
              deadlinesCount={studentHubIndicators.deadlinesCount}
              updatesUnread={studentHubIndicators.updatesUnread}
              deadlinesUnread={studentHubIndicators.deadlinesUnread}
              onOpenUpdates={openUpdatesFromIndicator}
              onOpenDeadlines={openDeadlinesFromIndicator}
            />
          ) : null}
          <QuickActionsMenu role={role} />
          <UserMenu
            role={role}
            userName={userName}
            userEmail={userEmail}
            profileHref={profileHref}
            canSwitchHubs={role === "STUDENT"}
            studentHubEnabled={studentFlags.studentHubCore}
            hubMode={studentHubMode}
            onHubModeChange={handleHubSwitch}
          />
        </div>
      </header>

      {dockItems.length > 0 && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className={`pointer-events-auto relative mx-auto w-full ${dockOuterHeightClass}`}>
            <Dock
              items={dockItems}
              panelHeight={dockPanelHeight}
              baseItemSize={dockBaseItemSize}
              magnification={dockMagnification}
              distance={dockDistance}
              className={dockClassName}
            />
          </div>
        </div>
      )}
    </>
  );
}
