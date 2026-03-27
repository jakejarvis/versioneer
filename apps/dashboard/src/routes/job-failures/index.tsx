import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { MoreHorizontal, RefreshCw, CheckCircle, Ban } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useJobFailures,
  useUpdateJobFailure,
  useRetryJobFailure,
} from "@/api/hooks/use-job-failures";
import type { JobFailureListItem } from "@/api/types";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const jobFailuresSearchSchema = z.object({
  ...paginatedSearchShape,
  status: z.enum(["open", "retrying", "resolved", "abandoned"]).catch("open"),
});

export const Route = createFileRoute("/job-failures/")({
  validateSearch: (search) => jobFailuresSearchSchema.parse(search),
  component: JobFailuresPage,
});

function JobFailuresPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const [selectedFailure, setSelectedFailure] = useState<JobFailureListItem | null>(null);
  const updateFailure = useUpdateJobFailure();
  const retryFailure = useRetryJobFailure();

  const { data, isLoading } = useJobFailures({
    status: searchState.status,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const handleRetry = useCallback(
    (id: string) => {
      retryFailure.mutate(id, {
        onSuccess: () => toast.success("Job re-enqueued"),
        onError: (err) => toast.error(err.message),
      });
    },
    [retryFailure],
  );

  const handleStatusChange = useCallback(
    (id: string, status: "resolved" | "abandoned" | "retrying") => {
      updateFailure.mutate(
        { id, status },
        {
          onSuccess: () => toast.success(`Marked as ${status}`),
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [updateFailure],
  );

  const columns = useMemo<ColumnDef<JobFailureListItem>[]>(
    () => [
      {
        accessorKey: "jobType",
        meta: { label: "Job Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Job Type" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.jobType}
          </span>
        ),
      },
      {
        id: "relatedRef",
        meta: { label: "Related" },
        enableSorting: false,
        cell: ({ row }) => <EntityReferenceLink refItem={row.original.relatedRef} />,
      },
      {
        id: "errorMessage",
        meta: { label: "Error" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Error" />,
        cell: ({ row }) =>
          row.original.errorMessage ? (
            <span
              className="block max-w-56 cursor-pointer truncate text-xs text-red-600 dark:text-red-400"
              onClick={() => setSelectedFailure(row.original)}
            >
              {row.original.errorMessage}
            </span>
          ) : (
            "--"
          ),
      },
      {
        accessorKey: "retryCount",
        meta: { label: "Retries" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Retries" />,
        cell: ({ row }) => row.original.retryCount,
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Created" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <TimeAgo date={row.original.createdAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.status === "open" || row.original.status === "retrying" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleRetry(row.original.id)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange(row.original.id, "resolved")}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Resolve
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange(row.original.id, "abandoned")}>
                  <Ban className="mr-2 h-4 w-4" />
                  Abandon
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [handleRetry, handleStatusChange],
  );

  const bulkActions: BulkAction<JobFailureListItem>[] = [
    {
      label: "Retry Selected",
      onClick: async (rows) => {
        for (const row of rows) {
          handleRetry(row.id);
        }
      },
    },
    {
      label: "Resolve Selected",
      onClick: async (rows) => {
        for (const row of rows) {
          handleStatusChange(row.id, "resolved");
        }
      },
    },
    {
      label: "Abandon Selected",
      variant: "destructive",
      onClick: async (rows) => {
        for (const row of rows) {
          handleStatusChange(row.id, "abandoned");
        }
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Job Failures</h2>
      <p className="mt-1 text-muted-foreground">Failed pipeline jobs and queue operations.</p>

      <div className="mt-4">
        <Select
          value={searchState.status}
          onValueChange={(value) =>
            void navigate({
              to: "/job-failures",
              search: {
                ...searchState,
                page: 1,
                status: value as typeof searchState.status,
              },
            })
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="retrying">Retrying</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No job failures."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/job-failures",
              search: applySortingToSearch(searchState, updater),
            })
          }
          manualSorting
          enableColumnVisibility
          enableRowSelection
          bulkActions={bulkActions}
          pagination={
            data
              ? {
                  total: data.total,
                  pageIndex: pagination.pageIndex,
                  pageSize: pagination.pageSize,
                  pageCount,
                  onPaginationChange: (updater) =>
                    void navigate({
                      to: "/job-failures",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>

      <Dialog open={!!selectedFailure} onOpenChange={(open) => !open && setSelectedFailure(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Error Detail</DialogTitle>
          </DialogHeader>
          {selectedFailure && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Job Type: </span>
                {selectedFailure.jobType}
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Job Key: </span>
                {selectedFailure.jobKey ?? "--"}
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Error:</span>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-red-50 dark:bg-red-900/30 p-3 font-mono text-xs text-red-800 dark:text-red-300">
                  {selectedFailure.errorMessage}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
