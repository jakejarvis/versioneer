import type { SourceHealthMetric } from "@/api/types";

export function HealthChart({ metrics }: { metrics: SourceHealthMetric[] }) {
  if (metrics.length === 0) {
    return <p className="text-sm text-muted-foreground">No health data available.</p>;
  }

  // Show most recent first (reversed for chronological left-to-right display)
  const sorted = [...metrics].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const maxAttempts = Math.max(...sorted.map((m) => m.fetchAttempts + m.parseAttempts), 1);

  return (
    <div className="rounded-lg border p-4">
      <h4 className="text-sm font-medium">Source Health (Last 30 Days)</h4>
      <div className="mt-3 flex items-end gap-0.5" style={{ height: "80px" }}>
        {sorted.map((m) => {
          const total = m.fetchAttempts + m.parseAttempts;
          const successes = m.fetchSuccesses + m.parseSuccesses;
          const rate = total > 0 ? successes / total : 0;
          const height = `${Math.max((total / maxAttempts) * 100, 4)}%`;
          const color =
            rate >= 0.9 ? "bg-emerald-500" : rate >= 0.7 ? "bg-amber-500" : "bg-red-500";

          return (
            <div
              key={m.id}
              className="flex-1 group relative"
              style={{ height: "100%" }}
              title={`${m.periodStart}: ${successes}/${total} (${Math.round(rate * 100)}%)`}
            >
              <div className="absolute bottom-0 w-full rounded-sm" style={{ height }}>
                <div className={`h-full w-full rounded-sm ${color}`} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{sorted[0]?.periodStart ?? ""}</span>
        <span>{sorted[sorted.length - 1]?.periodStart ?? ""}</span>
      </div>
    </div>
  );
}
