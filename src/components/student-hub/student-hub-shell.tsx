"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubNoticeCarousel, type HubNoticeItem } from "@/components/student-hub/hub-notice-carousel";
import styles from "./student-hub-shell.module.css";

const CELL_SIZE = 96;
const GRID_COLORS = [
  "oklch(0.72 0.16 237)",
  "oklch(0.74 0.14 196)",
  "oklch(0.79 0.13 164)",
  "oklch(0.83 0.14 80)",
  "oklch(0.73 0.16 20)",
];

type HubRoute = "dashboard" | "timetable" | "updates" | "deadlines" | "exams" | "groups" | "search";

type HubMetric = {
  label: string;
  value: string;
};

type StudentHubShellProps = {
  title: string;
  description: string;
  activeRoute: HubRoute;
  metrics?: HubMetric[];
  className?: string;
};

type QuickLinkCard = {
  id: "dashboard" | "timetable" | "updates" | "deadlines" | "exams" | "groups";
  title: string;
  href: string;
  description: string;
  badge: string;
  accent: string;
};

const quickLinkCards: QuickLinkCard[] = [
  {
    id: "dashboard",
    title: "Hub Dashboard",
    href: "/student/hub/dashboard",
    description: "Open the immersive classof2028-style Student Hub dashboard experience.",
    badge: "Overview",
    accent: "from-indigo-500/80 via-blue-500/70 to-cyan-700/70",
  },
  {
    id: "timetable",
    title: "Timetable Pulse",
    href: "/student/hub/timetable",
    description: "Track classes by day, venue, and lecturer with a clean weekly flow.",
    badge: "Schedule",
    accent: "from-cyan-500/80 via-sky-500/70 to-blue-700/70",
  },
  {
    id: "updates",
    title: "Class Broadcasts",
    href: "/student/hub/updates",
    description: "Follow cancellations, venue changes, and fresh notices in one stream.",
    badge: "Live Feed",
    accent: "from-amber-500/80 via-orange-500/70 to-red-600/70",
  },
  {
    id: "deadlines",
    title: "Deadline Radar",
    href: "/student/hub/deadlines",
    description: "Prioritize assignments by urgency before they turn into late work.",
    badge: "Assignments",
    accent: "from-emerald-500/80 via-teal-500/70 to-cyan-700/70",
  },
  {
    id: "exams",
    title: "Exam Center",
    href: "/student/hub/exams",
    description: "Review exam slots, attachments, and quick PDF search access.",
    badge: "Exams",
    accent: "from-violet-500/80 via-fuchsia-500/70 to-pink-700/70",
  },
  {
    id: "groups",
    title: "Group Arena",
    href: "/student/hub/groups",
    description: "Join study groups, vote leaders, and publish your invite links.",
    badge: "Collab",
    accent: "from-lime-500/80 via-green-500/70 to-emerald-700/70",
  },
];

const noticeSlides: HubNoticeItem[] = [
  {
    id: "notice-1",
    name: "Hub Signal",
    role: "Student Hub Notice",
    content: "Student Hub combines timetable, updates, deadlines, exams, and group coordination in one workspace.",
    avatar: "HS",
  },
  {
    id: "notice-2",
    name: "Attendance Safe",
    role: "System Notice",
    content: "Attendance Hub remains untouched. Mark Attendance flow and attendance records stay exactly as configured.",
    avatar: "AS",
  },
  {
    id: "notice-3",
    name: "Course-Ready",
    role: "Planner Notice",
    content: "Use this panel to jump between class planning and exam prep without losing context.",
    avatar: "CR",
  },
  {
    id: "notice-4",
    name: "Team Sync",
    role: "Collaboration Notice",
    content: "Group sessions and update broadcasts keep everyone aligned on deadlines and announcements.",
    avatar: "TS",
  },
];

function getRandomGridColor() {
  return GRID_COLORS[Math.floor(Math.random() * GRID_COLORS.length)];
}

function SubGridCell() {
  const [cellColors, setCellColors] = useState<Array<string | null>>([null, null, null, null]);
  const leaveTimeouts = useRef<Array<ReturnType<typeof setTimeout> | null>>([null, null, null, null]);

  const handleHover = (cellIdx: number) => {
    const timeout = leaveTimeouts.current[cellIdx];
    if (timeout) {
      clearTimeout(timeout);
      leaveTimeouts.current[cellIdx] = null;
    }
    setCellColors((prev) => prev.map((value, idx) => (idx === cellIdx ? getRandomGridColor() : value)));
  };

  const handleLeave = (cellIdx: number) => {
    leaveTimeouts.current[cellIdx] = setTimeout(() => {
      setCellColors((prev) => prev.map((value, idx) => (idx === cellIdx ? null : value)));
      leaveTimeouts.current[cellIdx] = null;
    }, 120);
  };

  useEffect(
    () => () => {
      leaveTimeouts.current.forEach((timeout) => timeout && clearTimeout(timeout));
    },
    [],
  );

  return (
    <div className={styles.subgrid} style={{ pointerEvents: "none" }}>
      {[0, 1, 2, 3].map((cellIdx) => (
        <button
          key={cellIdx}
          type="button"
          className={styles.cell}
          onMouseEnter={() => handleHover(cellIdx)}
          onMouseLeave={() => handleLeave(cellIdx)}
          style={{
            background: cellColors[cellIdx] || "transparent",
            pointerEvents: "auto",
          }}
        />
      ))}
    </div>
  );
}

function InteractiveGridBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [grid, setGrid] = useState({ columns: 0, rows: 0 });

  useEffect(() => {
    const updateGrid = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      setGrid({
        columns: Math.max(1, Math.ceil(width / CELL_SIZE)),
        rows: Math.max(1, Math.ceil(height / CELL_SIZE)),
      });
    };

    updateGrid();
    window.addEventListener("resize", updateGrid);
    return () => window.removeEventListener("resize", updateGrid);
  }, []);

  const totalCells = grid.columns * grid.rows;

  return (
    <div ref={containerRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <div
        className={styles.mainGrid}
        style={{
          gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
          width: "100%",
          height: "100%",
        }}
      >
        {Array.from({ length: totalCells }, (_, idx) => (
          <SubGridCell key={`hub-grid-${grid.columns}-${grid.rows}-${idx}`} />
        ))}
      </div>
    </div>
  );
}

export function StudentHubShell({
  title,
  description,
  activeRoute,
  metrics = [],
  className,
}: StudentHubShellProps) {
  const normalizedRoute = activeRoute === "search" ? "exams" : activeRoute;
  const [selectedCard, setSelectedCard] = useState<QuickLinkCard["id"]>(normalizedRoute);

  useEffect(() => {
    setSelectedCard(normalizedRoute);
  }, [normalizedRoute]);

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border/65 bg-gradient-to-br from-background/95 via-background/90 to-muted/40 p-5 sm:p-6",
        className,
      )}
    >
      <InteractiveGridBackground />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,oklch(0.86_0.06_222/.35),transparent_58%)]" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-0 w-72 bg-gradient-to-l from-background/65 via-background/30 to-transparent" />

      <div className="relative z-10 space-y-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
              Student Hub Experience
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Student Hub</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p>
            </div>

            {metrics.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:max-w-xl">
                {metrics.slice(0, 4).map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 backdrop-blur-sm"
                  >
                    <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{metric.label}</p>
                    <p className="mt-1 text-base font-semibold">{metric.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="pointer-events-auto rounded-2xl border border-border/65 bg-background/75 p-4 shadow-sm backdrop-blur-sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.13em] text-muted-foreground">Hub Notice</p>
            <HubNoticeCarousel items={noticeSlides} autoplay />
          </div>
        </div>

        <div className="pointer-events-auto">
          <div className="overflow-x-auto">
            <div className="flex min-w-max gap-3 pb-1">
              {quickLinkCards.map((card) => {
                const expanded = selectedCard === card.id;
                const isCurrent = normalizedRoute === card.id;

                return (
                  <motion.article
                    key={card.id}
                    layout
                    animate={{ width: expanded ? 368 : 202 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    onClick={() => setSelectedCard(card.id)}
                    className="relative h-[208px] shrink-0 cursor-pointer overflow-hidden rounded-2xl border border-border/65 bg-background/75 shadow-sm"
                  >
                    <div className={cn("absolute inset-y-0 left-0 w-[202px] bg-gradient-to-br", card.accent)} />
                    <div className="absolute inset-y-0 left-0 w-[202px] bg-black/10" />
                    <div className="relative z-10 flex h-full w-[202px] flex-col justify-between p-4 text-white">
                      <div className="space-y-2">
                        <span className="inline-flex rounded-full border border-white/35 bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                          {card.badge}
                        </span>
                        <h2 className="text-lg font-semibold leading-tight">{card.title}</h2>
                      </div>
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/90">
                        {isCurrent ? "Current Section" : "Preview Section"}
                      </p>
                    </div>

                    <AnimatePresence mode="wait">
                      {expanded ? (
                        <motion.div
                          key={`details-${card.id}`}
                          initial={{ opacity: 0, x: 14, filter: "blur(4px)" }}
                          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                          exit={{ opacity: 0, x: 14, filter: "blur(4px)" }}
                          transition={{ duration: 0.28 }}
                          className="absolute inset-y-0 right-0 w-[166px] border-l border-border/60 bg-background/90 p-3"
                        >
                          <div className="flex h-full flex-col justify-between">
                            <p className="text-xs leading-relaxed text-muted-foreground">{card.description}</p>
                            <Link
                              href={card.href}
                              onClick={(event) => event.stopPropagation()}
                              className={cn(
                                "inline-flex h-8 items-center justify-center rounded-md border px-2 text-xs font-medium transition",
                                isCurrent
                                  ? "border-cyan-500/45 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                                  : "border-border bg-background text-foreground hover:bg-muted/60",
                              )}
                            >
                              {isCurrent ? "Open" : "Go"}
                            </Link>
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.article>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
