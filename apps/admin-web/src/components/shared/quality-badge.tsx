import { cn } from "@/lib/utils";

const qualityConfig: Record<string, { color: string; dot: string; label: string }> = {
  green: { color: "text-emerald-700", dot: "bg-emerald-500", label: "Green" },
  yellow: { color: "text-amber-700", dot: "bg-amber-500", label: "Yellow" },
  red: { color: "text-red-700", dot: "bg-red-500", label: "Red" },
  unknown: { color: "text-zinc-500", dot: "bg-zinc-400", label: "Unknown" },
};

export function QualityBadge({ state, className }: { state: string; className?: string }) {
  const config = qualityConfig[state] ?? qualityConfig.unknown!;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        config.color,
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}
