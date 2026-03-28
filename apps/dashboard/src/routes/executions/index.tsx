import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { z } from "zod";

import { useExecutionDetail, useExecutions } from "@/api/hooks/use-executions";
import type { ExecutionListItem } from "@/api/types";
import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { AppEntityLink, ReleaseEntityLink } from "@/components/shared/entity-link";
import { JsonViewer } from "@/components/shared/json-viewer";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const executionsSearchSchema = z.object({
  ...paginatedSearchShape,
  status: z.string().catch("all"),
});

export const Route = createFileRoute("/executions/")({
  validateSearch: (search) => executionsSearchSchema.parse(search),
  component: ExecutionsPage,
});

function ExecutionsPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const { data: selectedExecution } = useExecutionDetail(selectedExecutionId ?? "");

  const { data, isLoading } = useExecutions({
    actionStatus: searchState.status !== "all" ? searchState.status : undefined,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const columns = useMemo<ColumnDef<ExecutionListItem>[]>(
    () => [
      {
        accessorKey: "actionType",
        meta: { label: "Action" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Action" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.actionType}
          </span>
        ),
      },
      {
        id: "app",
        meta: { label: "App" },
        enableSorting: false,
        cell: ({ row }) =>
          row.original.app ? <AppEntityLink app={row.original.app} showId /> : <span>--</span>,
      },
      {
        id: "release",
        meta: { label: "Release" },
        enableSorting: false,
        cell: ({ row }) =>
          row.original.release ? <ReleaseEntityLink release={row.original.release} showId /> : "--",
      },
      {
        accessorKey: "actionStatus",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.actionStatus} />,
      },
      {
        accessorKey: "installStrategy",
        meta: { label: "Strategy" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Strategy" />,
        cell: ({ row }) =>
          row.original.installStrategy ? (
            <StatusBadge status={row.original.installStrategy} />
          ) : (
            "--"
          ),
      },
      {
        accessorKey: "durationMs",
        meta: { label: "Duration" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Duration" />,
        cell: ({ row }) => (row.original.durationMs ? `${row.original.durationMs}ms` : "--"),
      },
      {
        accessorKey: "initiatedAt",
        meta: { label: "Initiated" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Initiated" />,
        cell: ({ row }) => <TimeAgo date={row.original.initiatedAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" onClick={() => setSelectedExecutionId(row.original.id)}>
            View
          </Button>
        ),
      },
    ],
    [],
  );

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Executions</h2>
      <p className="mt-1 text-muted-foreground">Client update execution audit trail.</p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={searchState.status}
          onValueChange={(value) =>
            void navigate({
              to: "/executions",
              search: {
                ...searchState,
                page: 1,
                status: value,
              },
            })
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="initiated">Initiated</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No execution records."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/executions",
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
                      to: "/executions",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>

      <Dialog
        open={Boolean(selectedExecutionId)}
        onOpenChange={(open) => !open && setSelectedExecutionId(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Execution Detail</DialogTitle>
          </DialogHeader>
          {selectedExecution ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-1">
                    <StatusBadge status={selectedExecution.actionStatus} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Action</dt>
                  <dd className="mt-1">{selectedExecution.actionType}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Before</dt>
                  <dd className="mt-1 font-mono text-xs">
                    {selectedExecution.clientVersionBefore ?? "--"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">After</dt>
                  <dd className="mt-1 font-mono text-xs">
                    {selectedExecution.clientVersionAfter ?? "--"}
                  </dd>
                </div>
              </dl>
              {selectedExecution.errorMessage ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Error</p>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {selectedExecution.errorMessage}
                  </pre>
                </div>
              ) : null}
              {selectedExecution.detailsJson ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Details</p>
                  <JsonViewer data={selectedExecution.detailsJson} className="mt-1" />
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
