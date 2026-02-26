import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: string; positive: boolean };
}

export function StatCard({ title, value, subtitle, icon, trend }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/45 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </p>
        <div className="rounded-full border border-border/70 bg-muted/60 p-2 text-foreground/80">
          {icon}
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {trend && (
          <p
            className={cn(
              "text-xs font-medium",
              trend.positive ? "text-foreground/80" : "text-muted-foreground"
            )}
          >
            {trend.positive ? "Up " : "Down "}
            {trend.value}
          </p>
        )}
      </div>
      {subtitle && (
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{subtitle}</p>
      )}
    </div>
  );
}

export function StatsGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}
