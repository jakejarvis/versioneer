import { formatDistanceToNow, format } from "date-fns";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TimeAgoProps {
  date: string | null | undefined;
  className?: string;
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  if (!date) return <span className="text-muted-foreground">--</span>;

  const d = new Date(date);
  const relative = formatDistanceToNow(d, { addSuffix: true });
  const absolute = format(d, "PPpp");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{relative}</span>
      </TooltipTrigger>
      <TooltipContent>{absolute}</TooltipContent>
    </Tooltip>
  );
}
