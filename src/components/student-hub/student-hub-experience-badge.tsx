import { Sparkles } from "lucide-react";

type StudentHubExperienceBadgeProps = {
  className?: string;
};

export function StudentHubExperienceBadge({ className = "" }: StudentHubExperienceBadgeProps) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/75 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground ${className}`}>
      <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
      Student Hub Experience
    </div>
  );
}

