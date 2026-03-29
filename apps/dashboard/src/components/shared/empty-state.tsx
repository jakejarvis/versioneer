import { Inbox } from "lucide-react";

import { Empty, EmptyHeader, EmptyMedia, EmptyDescription } from "@/components/ui/empty";

interface EmptyStateProps {
  message?: string;
  className?: string;
}

export function EmptyState({ message = "No data found.", className }: EmptyStateProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
