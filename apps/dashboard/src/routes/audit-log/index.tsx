import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { FileJson, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { ActionIconButton } from "@/components/shared/action-icon-button";
import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { JsonViewer } from "@/components/shared/json-viewer";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuditLog } from "@/hooks/use-audit-log";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchDefaults,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";
import type { AuditLogListItem } from "@/lib/types";

const auditLogSearchDefaults = {
  ...paginatedSearchDefaults,
  eventType: "",
  targetType: "",
  targetId: "",
};

const auditLogSearchSchema = z.object({
  ...paginatedSearchShape,
  eventType: z
    .string()
    .default(auditLogSearchDefaults.eventType)
    .catch(auditLogSearchDefaults.eventType),
  targetType: z
    .string()
    .default(auditLogSearchDefaults.targetType)
    .catch(auditLogSearchDefaults.targetType),
  targetId: z
    .string()
    .default(auditLogSearchDefaults.targetId)
    .catch(auditLogSearchDefaults.targetId),
});

export const Route = createFileRoute("/audit-log/")({
  validateSearch: auditLogSearchSchema,
  search: { middlewares: [stripSearchParams(auditLogSearchDefaults)] },
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
    targetType: searchState.targetType || undefined,
    targetId: searchState.targetId || undefined,
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
            <ActionIconButton
              label="View payload"
              icon={FileJson}
              onClick={() => setSelectedEntry(row.original)}
            />
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
          {searchState.targetType && searchState.targetId ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-md">
                {searchState.targetType}: {searchState.targetId}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/audit-log",
                    search: {
                      ...searchState,
                      page: 1,
                      targetType: "",
                      targetId: "",
                    },
                  })
                }
              >
                <X data-icon="inline-start" />
                Clear target
              </Button>
            </div>
          ) : null}
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
