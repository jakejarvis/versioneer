import { Badge } from "@/components/ui/badge";
import { statusColors, statusLabels } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colorClass =
    statusColors[status] ?? "bg-zinc-100 text-zinc-800 dark:bg-zinc-700/50 dark:text-zinc-300";
  const label = statusLabels[status] ?? status;

  return (
    <Badge variant="secondary" className={cn("rounded-md font-medium", colorClass, className)}>
      {label}
    </Badge>
  );
}
