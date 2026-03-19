interface Column {
  key: string;
  label: string;
}

type AttendanceRow = Record<string, React.ReactNode>;

interface AttendanceTableProps {
  columns: Column[];
  data: AttendanceRow[];
  emptyMessage?: string;
}

export function AttendanceTable({
  columns,
  data,
  emptyMessage = "No records found",
}: AttendanceTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-background/40">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] sm:min-w-[640px]">
          <thead>
            <tr className="border-b border-border/70 bg-muted/35">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground sm:px-4 sm:py-3 sm:text-[11px]"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-sm text-muted-foreground sm:px-4 sm:py-12"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-border/60 transition-colors hover:bg-muted/25 last:border-0"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className="px-3 py-3 text-sm align-middle text-foreground/90 sm:px-4 sm:py-3.5"
                    >
                      {row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
