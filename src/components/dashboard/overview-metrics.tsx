"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type OverviewMetric = {
  key: string;
  label: string;
  value: string | number;
  hint?: string;
};

type OverviewMetricsProps = {
  title: string;
  items: OverviewMetric[];
  compact?: boolean;
  showTitle?: boolean;
  showTopBorder?: boolean;
};

export function OverviewMetrics({
  title,
  items,
  compact = false,
  showTitle = true,
  showTopBorder = true,
}: OverviewMetricsProps) {
  if (compact) {
    return (
      <section className={cn("space-y-2", showTopBorder ? "border-t border-border/70 pt-4" : "pt-0")}>
        {showTitle ? (
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
        ) : null}
        <div className="mt-2 grid gap-2 grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-lg border border-border/70 bg-background/40 px-3 py-2.5"
            >
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-1 text-base font-semibold tabular-nums text-foreground sm:text-lg">
                {item.value}
              </p>
              {item.hint && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const firstKey = items[0]?.key ?? "";
  const [selectedKey, setSelectedKey] = useState(firstKey);

  const selected = useMemo(
    () => items.find((item) => item.key === selectedKey) ?? items[0],
    [items, selectedKey]
  );

  if (!selected) return null;

  return (
    <section className={cn("space-y-4", showTopBorder ? "border-t border-border/70 pt-4" : "pt-0")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {showTitle ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
          ) : null}
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{selected.value}</p>
          <p className="text-sm font-medium text-foreground">{selected.label}</p>
          {selected.hint && <p className="mt-0.5 text-xs text-muted-foreground">{selected.hint}</p>}
        </div>
        <label className="text-xs text-muted-foreground">
          Focus metric
          <select
            value={selectedKey}
            onChange={(event) => setSelectedKey(event.target.value)}
            className="mt-1 block w-full min-w-40 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {items.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSelectedKey(item.key)}
            className={cn(
              "rounded-lg border px-3 py-2 text-left transition-colors",
              item.key === selectedKey
                ? "border-foreground/20 bg-muted/70"
                : "border-border/70 bg-muted/35 hover:bg-muted/50"
            )}
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{item.value}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
