"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, ChevronLeft, ChevronRight, MapPin, Play, Repeat2, UserRound } from "lucide-react";
import styles from "./classof2028-dashboard.module.css";
import { StudentHubExperienceBadge } from "@/components/student-hub/student-hub-experience-badge";

const CELL_SIZE = 120;
const GRID_COLORS = ["oklch(0.72 0.2 352.53)", "#A764FF", "#4B94FD", "#FD4B4E", "#FF8743"];

const EASING = [0.4, 0.0, 0.2, 1] as const;

type Card = {
  id: number;
  title: string;
  image: string;
  content: string;
  author?: {
    name: string;
    role: string;
    image: string;
  };
};

type Testimonial = {
  name: string;
  role: string;
  content: string;
  avatar: string;
};

export type DashboardHeroStatus = "COMING_ON" | "CANCELLED" | "POSTPONED" | "VENUE_CHANGED";

export type DashboardHeroInfo = {
  contextLabel: "Next Class" | "Upcoming Exam";
  courseName: string;
  courseCode: string;
  timeLabel: string;
  startAt?: string | null;
  endAt?: string | null;
  state: DashboardHeroStatus;
  venueLabel?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
};

const people = [
  { name: "Eduardo Calvo", role: "CEO & Founder", avatar: "EC" },
  { name: "Sarah Chen", role: "Head of Design", avatar: "SC" },
  { name: "Marcus Johnson", role: "Lead Developer", avatar: "MJ" },
  { name: "Emily Rodriguez", role: "Product Manager", avatar: "ER" },
];

const cards: Card[] = [
  {
    id: 1,
    title: "Summer Opening",
    image:
      "https://res.cloudinary.com/dyzxnud9z/image/upload/w_400,ar_1:1,c_fill,g_auto/v1758210208/smoothui/summer-opening.webp",
    content:
      "Join us for the Summer Opening event, where we celebrate the start of a vibrant season filled with art and culture.",
    author: {
      name: people[0].name,
      role: people[0].role,
      image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${people[0].avatar}&size=96`,
    },
  },
  {
    id: 2,
    title: "Fashion",
    image:
      "https://res.cloudinary.com/dyzxnud9z/image/upload/w_400,ar_1:1,c_fill,g_auto/v1758210208/smoothui/fashion.webp",
    content:
      "Explore the latest trends in fashion at our exclusive showcase, featuring renowned designers and unique styles.",
    author: {
      name: people[1].name,
      role: people[1].role,
      image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${people[1].avatar}&size=96`,
    },
  },
  {
    id: 3,
    title: "Gallery Art",
    image:
      "https://res.cloudinary.com/dyzxnud9z/image/upload/w_400,ar_1:1,c_fill,g_auto/v1758210809/smoothui/galleryart.webp",
    content:
      "Immerse yourself in the world of art at our gallery, showcasing stunning pieces from emerging and established artists.",
    author: {
      name: people[2].name,
      role: people[2].role,
      image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${people[2].avatar}&size=96`,
    },
  },
  {
    id: 4,
    title: "Dreams",
    image:
      "https://res.cloudinary.com/dyzxnud9z/image/upload/w_400,ar_1:1,c_fill,g_auto/v1758210809/smoothui/dreams.webp",
    content: "Join us on a journey through dreams, exploring the subconscious and the art of dreaming.",
    author: {
      name: people[3].name,
      role: people[3].role,
      image: `https://api.dicebear.com/7.x/avataaars/svg?seed=${people[3].avatar}&size=96`,
    },
  },
];

const testimonials: Testimonial[] = [
  {
    name: "Oluchi",
    role: "Course Representative",
    content: "We will be having a guest lecture on AI advancements next week. Don't miss it!",
    avatar: "OC",
  },
  {
    name: "Kelvin Parkingston",
    role: "Course Representative",
    content: "Remember to check the forum for updates on assignment deadlines and project guidelines.",
    avatar: "PK",
  },
  {
    name: "Randa",
    role: "Course Representative",
    content: "The midterm exam will cover all topics discussed in lectures up to week 6. Study hard!",
    avatar: "RD",
  },
  {
    name: "Felix",
    role: "Course Representative",
    content: "Join us for the coding workshop this Friday to enhance your programming skills!",
    avatar: "FX",
  },
];

function getRandomColor() {
  return GRID_COLORS[Math.floor(Math.random() * GRID_COLORS.length)];
}

function SubGrid() {
  const [cellColors, setCellColors] = useState<Array<string | null>>([null, null, null, null]);
  const leaveTimeouts = useRef<Array<ReturnType<typeof setTimeout> | null>>([null, null, null, null]);

  function handleHover(cellIdx: number) {
    const timeout = leaveTimeouts.current[cellIdx];
    if (timeout) {
      clearTimeout(timeout);
      leaveTimeouts.current[cellIdx] = null;
    }
    setCellColors((prev) => prev.map((value, idx) => (idx === cellIdx ? getRandomColor() : value)));
  }

  function handleLeave(cellIdx: number) {
    leaveTimeouts.current[cellIdx] = setTimeout(() => {
      setCellColors((prev) => prev.map((value, idx) => (idx === cellIdx ? null : value)));
      leaveTimeouts.current[cellIdx] = null;
    }, 120);
  }

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
          className={styles.cell}
          type="button"
          onMouseEnter={() => handleHover(cellIdx)}
          onMouseLeave={() => handleLeave(cellIdx)}
          style={{ background: cellColors[cellIdx] || "transparent", pointerEvents: "auto" }}
        />
      ))}
    </div>
  );
}

function InteractiveGrid() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [grid, setGrid] = useState({ columns: 0, rows: 0 });

  useEffect(() => {
    function updateGrid() {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      setGrid({
        columns: Math.ceil(width / CELL_SIZE),
        rows: Math.ceil(height / CELL_SIZE),
      });
    }
    updateGrid();
    window.addEventListener("resize", updateGrid);
    return () => window.removeEventListener("resize", updateGrid);
  }, []);

  const total = grid.columns * grid.rows;

  return (
    <div ref={containerRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <div
        className={styles.mainGrid}
        style={{
          gridTemplateColumns: `repeat(${grid.columns}, 1fr)`,
          gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
          width: "100%",
          height: "100%",
        }}
      >
        {Array.from({ length: total }, (_, idx) => (
          <SubGrid key={`subgrid-${grid.columns}-${grid.rows}-${idx}`} />
        ))}
      </div>
    </div>
  );
}

function HubNotice() {
  const [active, setActive] = useState(0);
  const [autoplay] = useState(true);
  const [paused, setPaused] = useState(false);

  const handleNext = useCallback(() => {
    setActive((prev) => (prev + 1) % testimonials.length);
  }, []);

  const handlePrev = useCallback(() => {
    setActive((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  }, []);

  useEffect(() => {
    if (!autoplay || paused) return;
    const interval = setInterval(handleNext, 5000);
    return () => clearInterval(interval);
  }, [autoplay, handleNext, paused]);

  const isActive = (index: number) => index === active;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Hub Notice</span>
        </div>
        <motion.button
          onClick={handlePrev}
          className="group/button bg-background flex h-8 w-8 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 hover:shadow-xl"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          type="button"
          aria-label="Previous notice"
        >
          <ChevronLeft className="text-foreground h-5 w-5 transition-transform duration-300 group-hover/button:-rotate-12" />
        </motion.button>
        <motion.button
          onClick={handleNext}
          className="group/button bg-background flex h-8 w-8 items-center justify-center rounded-full border shadow-lg transition-all duration-200 hover:scale-110 hover:shadow-xl"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          type="button"
          aria-label="Next notice"
        >
          <ChevronRight className="text-foreground h-5 w-5 transition-transform duration-300 group-hover/button:rotate-12" />
        </motion.button>
      </div>

      <div
        className="relative mx-auto h-full w-full max-w-md min-h-[260px]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerCancel={() => setPaused(false)}
      >
        <AnimatePresence>
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{
                opacity: isActive(index) ? 1 : 0,
                scale: isActive(index) ? 1 : 0.95,
                y: isActive(index) ? 0 : 30,
              }}
              exit={{ opacity: 0, scale: 0.9, y: -30 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className={`absolute inset-0 min-h-fit ${isActive(index) ? "z-10" : "z-0"}`}
            >
              <div className="bg-background rounded-2xl border px-6 py-6 shadow-lg transition-all duration-200">
                <motion.p
                  key={active}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-foreground mb-6 text-base sm:text-lg"
                >
                  {(testimonial.content || "").split(" ").map((word, wordIndex) => (
                    <motion.span
                      key={`${testimonial.name}-word-${wordIndex}`}
                      initial={{ filter: "blur(4px)", opacity: 0, y: 5 }}
                      animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut", delay: wordIndex * 0.02 }}
                      className="inline-block"
                    >
                      {word}&nbsp;
                    </motion.span>
                  ))}
                </motion.p>

                <motion.div
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 }}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground text-sm font-semibold">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="text-foreground font-semibold">{testimonial.name}</div>
                    <span className="text-muted-foreground text-sm">{testimonial.role}</span>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

function ExpandableCards({ cards }: { cards: Card[] }) {
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    const scrollWidth = scrollRef.current.scrollWidth;
    const clientWidth = scrollRef.current.clientWidth;
    scrollRef.current.scrollLeft = (scrollWidth - clientWidth) / 2;
  }, []);

  const handleCardClick = (id: number) => {
    if (selectedCard === id) {
      setSelectedCard(null);
      return;
    }
    setSelectedCard(id);
    const cardElement = document.querySelector(`[data-card-id="${id}"]`);
    if (cardElement) {
      cardElement.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  };

  return (
    <div className="flex w-full flex-col gap-4 overflow-scroll p-4">
      <div
        ref={scrollRef}
        className={`mx-auto flex overflow-x-auto pt-4 pb-8 ${styles.scrollbarHide}`}
        style={{ scrollSnapType: "x mandatory", scrollPaddingLeft: "20%" }}
      >
        {cards.map((card) => (
          <motion.div
            key={card.id}
            layout
            animate={{ width: selectedCard === card.id ? "500px" : "200px" }}
            transition={{ duration: 0.5, ease: EASING }}
            onClick={() => handleCardClick(card.id)}
            data-card-id={card.id}
            className="relative mr-4 h-[300px] shrink-0 cursor-pointer overflow-hidden rounded-2xl border bg-background shadow-lg"
            style={{ scrollSnapAlign: "start" }}
          >
            <div className="relative h-full w-[200px]">
              <img
                alt={card.title}
                className="h-full w-full object-cover"
                height={300}
                width={200}
                src={card.image || "/placeholder.svg"}
              />
              <div className="absolute inset-0 bg-black/20" />
              <div className="absolute inset-0 flex flex-col justify-between p-6 text-white">
                <h2 className="font-bold text-2xl">{card.title}</h2>
                <div className="flex items-center gap-2">
                  <button
                    aria-label="Open Card"
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-background/30 backdrop-blur-sm transition-transform hover:scale-110"
                    type="button"
                  >
                    <Play className="h-6 w-6 text-white" />
                  </button>
                  <span className="font-medium text-sm">Open Card</span>
                </div>
              </div>
            </div>

            <AnimatePresence mode="popLayout">
              {selectedCard === card.id ? (
                <motion.div
                  initial={{ width: 0, opacity: 0, filter: "blur(5px)" }}
                  animate={{ width: "300px", opacity: 1, filter: "blur(0px)" }}
                  exit={{ width: 0, opacity: 0, filter: "blur(5px)" }}
                  transition={{ duration: 0.5, ease: EASING, opacity: { duration: 0.3, delay: 0.2 } }}
                  className="absolute top-0 right-0 h-full bg-background"
                >
                  <motion.div
                    initial={{ opacity: 0, x: 20, filter: "blur(5px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: 20, filter: "blur(5px)" }}
                    transition={{ delay: 0.4, duration: 0.3 }}
                    className="flex h-full flex-col justify-between p-8"
                  >
                    <p className="text-foreground text-sm">{card.content}</p>
                    {card.author ? (
                      <div className="mt-4 flex items-center gap-3">
                        <div className="h-12 w-12 overflow-hidden rounded-full border bg-primary">
                          <img
                            alt={card.author.name}
                            className="h-full w-full object-cover"
                            height={48}
                            width={48}
                            src={card.author.image}
                          />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{card.author.name}</p>
                          <p className="text-foreground text-xs">{card.author.role}</p>
                        </div>
                      </div>
                    ) : null}
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function getStatusMeta(state: DashboardHeroStatus) {
  switch (state) {
    case "CANCELLED":
      return {
        label: "Cancelled",
        className: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300",
      };
    case "POSTPONED":
      return {
        label: "Postponed",
        className: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
      };
    case "VENUE_CHANGED":
      return {
        label: "Venue Changed",
        className: "border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300",
      };
    default:
      return {
        label: "Coming On",
        className: "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      };
  }
}

function formatChangedAt(value?: string | null) {
  if (!value) return "No change record";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No change record";
  return parsed.toLocaleString();
}

function splitDateAndTime(info: DashboardHeroInfo | null) {
  if (!info?.startAt) {
    return { dateText: "Not set", timeText: info?.timeLabel || "Not set" };
  }

  const start = new Date(info.startAt);
  if (Number.isNaN(start.getTime())) {
    return { dateText: "Not set", timeText: info.timeLabel || "Not set" };
  }

  const dateText = start.toLocaleDateString();
  const startTime = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (info.endAt) {
    const end = new Date(info.endAt);
    if (!Number.isNaN(end.getTime())) {
      const endTime = end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return { dateText, timeText: `${startTime} - ${endTime}` };
    }
  }

  return { dateText, timeText: startTime };
}

function HeroStatusCard({
  mode,
  classInfo,
  examInfo,
  hasExamInfo,
  onToggleMode,
  showInlineToggle,
}: {
  mode: "class" | "exam";
  classInfo: DashboardHeroInfo | null;
  examInfo: DashboardHeroInfo | null;
  hasExamInfo: boolean;
  onToggleMode: () => void;
  showInlineToggle: boolean;
}) {
  const activeInfo = mode === "exam" ? examInfo : classInfo;
  const status = getStatusMeta(activeInfo?.state ?? "COMING_ON");
  const fallbackTitle = mode === "exam" ? "No upcoming exam found" : "No upcoming class found";
  const fallbackMessage =
    mode === "exam"
      ? "Publish exam timetable entries to show an exam status snapshot here."
      : "Publish timetable entries for this cohort to show the next class snapshot.";

  const { dateText, timeText } = splitDateAndTime(activeInfo);

  return (
    <motion.div
      className="pointer-events-auto w-full rounded-3xl border border-border/70 bg-background/85 p-4 text-left shadow-lg backdrop-blur-sm sm:p-5"
      initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={showInlineToggle ? "flex items-start justify-between gap-3" : ""}>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {showInlineToggle
              ? "Live Course Signal"
              : activeInfo?.contextLabel || (mode === "class" ? "Next Class" : "Upcoming Exam")}
          </p>
          <div className="mt-1 max-w-full overflow-x-auto whitespace-nowrap">
            <h2 className="inline text-lg font-semibold tracking-tight sm:text-xl lg:text-2xl">
              {activeInfo ? activeInfo.courseName : fallbackTitle}
            </h2>
          </div>
        </div>
        {showInlineToggle ? (
          <button
            type="button"
            onClick={onToggleMode}
            disabled={!hasExamInfo}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Repeat2 className="h-3.5 w-3.5" />
            {mode === "class" ? "Show Exams" : "Show Class"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border/70 pt-3">
        {activeInfo ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/80">
                Course
              </span>
              <span className="inline-flex rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/80">
                {activeInfo.courseCode}
              </span>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${status.className}`}
              >
                {status.label}
              </span>
              <span className="inline-flex rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/80 sm:hidden">
                {dateText}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2">
              <div className="hidden rounded-xl border border-border/60 bg-background/70 p-3 sm:block">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Date</p>
                <p className="mt-1 text-sm font-medium text-foreground">{dateText}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Time</p>
                <p className="mt-1 text-sm font-medium text-foreground">{timeText}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Venue</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {activeInfo.venueLabel || "TBA"}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Updated By</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                  {activeInfo.updatedBy || "No editor recorded"}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3 sm:col-span-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Changed At</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatChangedAt(activeInfo.updatedAt)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{fallbackMessage}</p>
        )}
      </div>
    </motion.div>
  );
}

export function Classof2028Dashboard({
  classInfo,
  examInfo,
}: {
  classInfo: DashboardHeroInfo | null;
  examInfo: DashboardHeroInfo | null;
}) {
  const [mode, setMode] = useState<"class" | "exam">("class");
  const hasExamInfo = Boolean(examInfo);

  useEffect(() => {
    if (mode === "exam" && !hasExamInfo) {
      setMode("class");
    }
  }, [hasExamInfo, mode]);

  return (
    <div className="h-full w-full space-y-6">
      <div className="space-y-4 lg:hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <StudentHubExperienceBadge className="min-w-0 max-w-full justify-self-start" />
          <button
            type="button"
            onClick={() => setMode((prev) => (prev === "class" ? "exam" : "class"))}
            disabled={!hasExamInfo}
            aria-label={mode === "class" ? "Show exams" : "Show class"}
            className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Repeat2 className="h-3.5 w-3.5" />
            <span className="sm:hidden whitespace-nowrap">{mode === "class" ? "Exams" : "Class"}</span>
            <span className="hidden whitespace-nowrap sm:inline">{mode === "class" ? "Show Exams" : "Show Class"}</span>
          </button>
        </div>

        <HeroStatusCard
          mode={mode}
          classInfo={classInfo}
          examInfo={examInfo}
          hasExamInfo={hasExamInfo}
          onToggleMode={() => setMode((prev) => (prev === "class" ? "exam" : "class"))}
          showInlineToggle={false}
        />
      </div>

      <section className="relative hidden overflow-hidden rounded-3xl border border-border/70 bg-background/60 p-4 sm:p-6 lg:block lg:p-8">
        <InteractiveGrid />
        <div className="pointer-events-none relative z-10 flex flex-col gap-5">
          <div className="pointer-events-auto">
            <StudentHubExperienceBadge />
          </div>
          <HeroStatusCard
            mode={mode}
            classInfo={classInfo}
            examInfo={examInfo}
            hasExamInfo={hasExamInfo}
            onToggleMode={() => setMode((prev) => (prev === "class" ? "exam" : "class"))}
            showInlineToggle
          />
        </div>
      </section>

      <HubNotice />

      <section id="lecturers" className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Lecturers</span>
        </div>
        <ExpandableCards cards={cards} />
      </section>
    </div>
  );
}
