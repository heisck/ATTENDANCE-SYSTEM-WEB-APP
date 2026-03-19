"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type DashboardButtonVariant = "primary" | "secondary" | "danger";

export function getDashboardButtonClassName(input?: {
  variant?: DashboardButtonVariant;
  fullWidth?: boolean;
  pressed?: boolean;
  className?: string;
}) {
  const variant = input?.variant ?? "secondary";

  return cn(
    "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out hover:shadow-sm active:translate-y-px active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none",
    variant === "primary" &&
      "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
    variant === "secondary" &&
      "border-border/70 bg-background/70 text-foreground hover:bg-accent",
    variant === "danger" &&
      "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15",
    input?.pressed && variant === "secondary" && "border-primary/40 bg-primary/10 text-foreground",
    input?.fullWidth && "w-full",
    input?.className
  );
}

function IconSlot({
  loading,
  icon: Icon,
}: {
  loading?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
      {loading ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : Icon ? (
        <Icon className="h-4 w-4" />
      ) : (
        <span className="h-4 w-4" aria-hidden="true" />
      )}
    </span>
  );
}

export function DashboardActionButton({
  children,
  className,
  fullWidth,
  icon,
  loading,
  pressed,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  fullWidth?: boolean;
  icon?: LucideIcon;
  loading?: boolean;
  pressed?: boolean;
  variant?: DashboardButtonVariant;
}) {
  const hasLeadingVisual = loading || Boolean(icon);

  return (
    <button
      {...props}
      aria-pressed={pressed}
      className={getDashboardButtonClassName({
        variant,
        fullWidth,
        pressed,
        className,
      })}
    >
      {hasLeadingVisual ? <IconSlot loading={loading} icon={icon} /> : null}
      <span className="min-w-0 text-center">{children}</span>
      {hasLeadingVisual ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="h-4 w-4 opacity-0" />
        </span>
      ) : null}
    </button>
  );
}

export function DashboardBinaryChoiceField({
  className,
  description,
  falseLabel = "Off",
  label,
  onChange,
  trueLabel = "On",
  value,
}: {
  className?: string;
  description?: ReactNode;
  falseLabel?: string;
  label: string;
  onChange: (value: boolean) => void;
  trueLabel?: string;
  value: boolean;
}) {
  return (
    <div className={cn("space-y-3 rounded-xl border border-border/70 bg-background/30 p-3", className)}>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <DashboardActionButton
          type="button"
          variant={value ? "primary" : "secondary"}
          pressed={value}
          onClick={() => onChange(true)}
          fullWidth
        >
          {trueLabel}
        </DashboardActionButton>
        <DashboardActionButton
          type="button"
          variant={!value ? "primary" : "secondary"}
          pressed={!value}
          onClick={() => onChange(false)}
          fullWidth
        >
          {falseLabel}
        </DashboardActionButton>
      </div>
    </div>
  );
}

export function DashboardFieldCard({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={cn("space-y-2 rounded-xl border border-border/70 bg-background/30 p-3", className)}>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
