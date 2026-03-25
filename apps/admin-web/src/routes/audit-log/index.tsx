import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

import { useAuditLog } from "@/api/hooks/use-audit-log";
import type { AuditLogEntry } from "@/api/types";
import { DataTable, type Column } from "@/components/shared/data-table";
import { IdDisplay } from "@/components/shared/id-display";
import { JsonViewer } from "@/components/shared/json-viewer";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/audit-log/")({
  component: AuditLogPage,
});

function AuditLogPage() {
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const { data, isLoading } = useAuditLog({
    eventType: eventTypeFilter || undefined,
    limit: 50,
    offset,
  });

  const columns: Column<AuditLogEntry>[] = [
    {
      key: "eventType",
      header: "Event",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{row.eventType}</span>
      ),
    },
    {
      key: "actorType",
      header: "Actor",
      cell: (row) => (
        <span className="text-sm">
          {row.actorType ?? "--"}
          {row.actorId ? `: ${row.actorId}` : ""}
        </span>
      ),
    },
    {
      key: "targetType",
      header: "Target",
      cell: (row) =>
        row.targetType ? (
          <span className="text-sm">
            {row.targetType}
            {row.targetId ? ": " : ""}
            {row.targetId && <IdDisplay id={row.targetId} />}
          </span>
        ) : (
          "--"
        ),
    },
    {
      key: "createdAt",
      header: "Time",
      cell: (row) => <TimeAgo date={row.createdAt} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        row.payloadJson ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedEntry(row);
            }}
          >
            Payload
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Audit Log</h2>
      <p className="mt-1 text-muted-foreground">Immutable event log for state changes.</p>

      <div className="mt-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by event type..."
            value={eventTypeFilter}
            onChange={(e) => {
              setEventTypeFilter(e.target.value);
              setOffset(0);
            }}
            className="pl-9"
          />
        </div>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No audit log entries."
          pagination={
            data
              ? {
                  total: data.total,
                  limit: data.limit,
                  offset: data.offset,
                  onOffsetChange: setOffset,
                }
              : undefined
          }
        />
      </div>

      <Dialog open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedEntry?.eventType} Payload</DialogTitle>
          </DialogHeader>
          {selectedEntry && <JsonViewer data={selectedEntry.payloadJson} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
