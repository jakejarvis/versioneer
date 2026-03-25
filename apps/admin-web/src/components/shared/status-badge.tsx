import { Badge } from "@/components/ui/badge";
import { statusColors, statusLabels } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colorClass = statusColors[status] ?? "bg-zinc-100 text-zinc-800";
  const label = statusLabels[status] ?? status;

  return (
    <Badge
      variant="secondary"
      className={cn("font-medium", colorClass, className)}
    >
      {label}
    </Badge>
  );
}
