import { Link } from "@tanstack/react-router";
import { FileJson, History } from "lucide-react";
import { useState } from "react";

import { ActionIconButton } from "@/components/shared/action-icon-button";
import { JsonViewer } from "@/components/shared/json-viewer";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLog } from "@/hooks/use-audit-log";
import type { AuditLogListItem } from "@/lib/types";

export function EntityAuditPanel({
  targetType,
  targetId,
  title = "Audit Trail",
  description = "Recent direct state changes for this record.",
}: {
  targetType: string;
  targetId: string;
  title?: string;
  description?: string;
}) {
  const [selectedEntry, setSelectedEntry] = useState<AuditLogListItem | null>(null);
  const { data, isLoading } = useAuditLog({
    targetType,
    targetId,
    limit: 5,
    offset: 0,
    sortBy: "createdAt",
    sortDir: "desc",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Link
            to="/audit-log"
            search={{
              page: 1,
              pageSize: 25,
              eventType: "",
              targetType,
              targetId,
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History />
              </EmptyMedia>
              <EmptyDescription>No direct audit events.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {data?.items.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-md">
                      {item.eventType}
                    </Badge>
                    <TimeAgo date={item.createdAt} className="text-xs text-muted-foreground" />
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {item.actorType ?? "unknown"}
                    {item.actorId ? `: ${item.actorId}` : ""}
                  </div>
                </div>
                {item.payloadJson ? (
                  <ActionIconButton
                    label="View payload"
                    icon={FileJson}
                    onClick={() => setSelectedEntry(item)}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedEntry?.eventType} Payload</DialogTitle>
          </DialogHeader>
          {selectedEntry ? <JsonViewer data={selectedEntry.payloadJson} /> : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
