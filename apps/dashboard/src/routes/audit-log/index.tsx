import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { useAuditLog } from "@/api/hooks/use-audit-log";
import type { AuditLogListItem } from "@/api/types";
import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { JsonViewer } from "@/components/shared/json-viewer";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const auditLogSearchSchema = z.object({
  ...paginatedSearchShape,
  eventType: z.string().catch(""),
});

export const Route = createFileRoute("/audit-log/")({
  validateSearch: (search) => auditLogSearchSchema.parse(search),
  component: AuditLogPage,
});

function AuditLogPage() {
  const searchState = Route.useSearch();
  const navigate = Route.useNavigate();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const [selectedEntry, setSelectedEntry] = useState<AuditLogListItem | null>(null);

  const { data, isLoading } = useAuditLog({
    eventType: searchState.eventType || undefined,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const columns = useMemo<ColumnDef<AuditLogListItem>[]>(
    () => [
      {
        accessorKey: "eventType",
        meta: { label: "Event" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Event" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.eventType}
          </span>
        ),
      },
      {
        accessorKey: "actorType",
        meta: { label: "Actor" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Actor" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.actorType ?? "--"}
            {row.original.actorId ? `: ${row.original.actorId}` : ""}
          </span>
        ),
      },
      {
        accessorKey: "targetType",
        meta: { label: "Target" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Target" />,
        cell: ({ row }) => <EntityReferenceLink refItem={row.original.targetRef} />,
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Time" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Time" />,
        cell: ({ row }) => <TimeAgo date={row.original.createdAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.payloadJson ? (
            <Button variant="ghost" size="sm" onClick={() => setSelectedEntry(row.original)}>
              Payload
            </Button>
          ) : null,
      },
    ],
    [],
  );

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Audit Log</h2>
      <p className="mt-1 text-muted-foreground">Immutable event log for state changes.</p>

      <div className="mt-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by event type..."
            value={searchState.eventType}
            onChange={(e) =>
              void navigate({
                to: "/audit-log",
                search: {
                  ...searchState,
                  page: 1,
                  eventType: e.target.value,
                },
              })
            }
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
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/audit-log",
              search: applySortingToSearch(searchState, updater),
            })
          }
          manualSorting
          enableColumnVisibility
          pagination={
            data
              ? {
                  total: data.total,
                  pageIndex: pagination.pageIndex,
                  pageSize: pagination.pageSize,
                  pageCount,
                  onPaginationChange: (updater) =>
                    void navigate({
                      to: "/audit-log",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
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
