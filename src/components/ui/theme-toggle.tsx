"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

type ThemeChoice = "light" | "dark" | "system";
type ThemeOptionProps = {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const activeTheme: ThemeChoice =
    mounted && (theme === "light" || theme === "dark" || theme === "system") ? theme : "system";

  const currentIcon =
    !mounted ? (
      <span className="inline-block h-4 w-4" />
    ) : activeTheme === "light" ? (
      <Sun className="h-4 w-4" />
    ) : activeTheme === "dark" ? (
      <Moon className="h-4 w-4" />
    ) : (
      <Monitor className="h-4 w-4" />
    );

  function selectTheme(value: ThemeChoice) {
    setTheme(value);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        aria-label="Theme selection"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span suppressHydrationWarning>{currentIcon}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-36 rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          <ThemeOption
            icon={<Sun className="h-4 w-4 text-muted-foreground" />}
            label="Light"
            active={activeTheme === "light"}
            onClick={() => selectTheme("light")}
          />
          <ThemeOption
            icon={<Moon className="h-4 w-4 text-muted-foreground" />}
            label="Dark"
            active={activeTheme === "dark"}
            onClick={() => selectTheme("dark")}
          />
          <ThemeOption
            icon={<Monitor className="h-4 w-4 text-muted-foreground" />}
            label="System"
            active={activeTheme === "system"}
            onClick={() => selectTheme("system")}
          />
        </div>
      )}
    </div>
  );
}

function ThemeOption({
  icon,
  label,
  active,
  onClick,
}: ThemeOptionProps) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm text-popover-foreground hover:bg-accent"
    >
      <span className="inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
      {active && <Check className="h-4 w-4" />}
    </button>
  );
}
