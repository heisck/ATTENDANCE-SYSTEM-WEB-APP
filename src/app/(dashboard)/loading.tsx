export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
        <div className="h-8 w-56 animate-pulse rounded bg-muted/60" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted/50" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl border border-border/60 bg-muted/30" />
        ))}
      </div>

      <div className="h-72 animate-pulse rounded-xl border border-border/60 bg-muted/30" />
    </div>
  );
}
