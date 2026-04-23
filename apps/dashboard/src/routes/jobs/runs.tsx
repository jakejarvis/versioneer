import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Activity, Clock3 } from "lucide-react";
import { useMemo } from "react";

import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CronJobRun, jobTypeLabels, ManualOperations } from "@/features/jobs/manual-operations";
import {
  jobTypeSchema,
  jobsRunsSearchDefaults,
  jobsRunsSearchSchema,
  type JobsRunsSearch,
} from "@/features/jobs/search";
import { useCronJobRuns } from "@/hooks/use-jobs";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";
import { formatDuration } from "@/lib/format-duration";

export const Route = createFileRoute("/jobs/runs")({
  validateSearch: jobsRunsSearchSchema,
  search: { middlewares: [stripSearchParams(jobsRunsSearchDefaults)] },
  component: JobsRunsPage,
});

function JobsRunsPage() {
  const search = Route.useSearch();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Operations
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Run History</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Monitor scheduled and manual jobs without carrying failure queue state in the URL.
        </p>
      </div>

      <ManualOperations />
      <RunHistory search={search} />
    </div>
  );
}

function RunHistory({ search }: { search: JobsRunsSearch }) {
  const navigate = Route.useNavigate();
  const tableSearch = {
    page: search.page,
    pageSize: search.pageSize,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  };
  const pagination = paginationFromSearch(tableSearch);
  const sorting = sortingFromSearch(tableSearch);

  const { data, isLoading } = useCronJobRuns({
    jobType: search.jobType === "all" ? undefined : search.jobType,
    trigger: search.trigger === "all" ? undefined : search.trigger,
    status: search.status === "all" ? undefined : search.status,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  });

  const columns = useMemo<ColumnDef<CronJobRun>[]>(
    () => [
      {
        accessorKey: "jobType",
        meta: { label: "Job" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Job" />,
        cell: ({ row }) => <Badge variant="secondary">{jobTypeLabels[row.original.jobType]}</Badge>,
      },
      {
        accessorKey: "trigger",
        meta: { label: "Trigger" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Trigger" />,
        cell: ({ row }) => <span className="text-sm capitalize">{row.original.trigger}</span>,
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "items",
        meta: { label: "Items" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Items" />,
        cell: ({ row }) => {
          const { itemsQueued, itemsTotal } = row.original;
          if (itemsQueued == null) return "--";
          if (itemsTotal != null) return `${itemsQueued} / ${itemsTotal}`;
          return itemsQueued;
        },
      },
      {
        accessorKey: "startedAt",
        meta: { label: "Started" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Started" />,
        cell: ({ row }) => <TimeAgo date={row.original.startedAt} />,
      },
      {
        id: "duration",
        meta: { label: "Duration" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Duration" />,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDuration(row.original.startedAt, row.original.completedAt)}
          </span>
        ),
      },
      {
        id: "errorMessage",
        meta: { label: "Error" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Error" />,
        cell: ({ row }) =>
          row.original.errorMessage ? (
            <span className="block max-w-64 truncate text-xs text-red-600 dark:text-red-400">
              {row.original.errorMessage}
            </span>
          ) : (
            <span className="text-muted-foreground">--</span>
          ),
      },
    ],
    [],
  );

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <section className="space-y-4 rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Clock3 className="h-4 w-4 text-muted-foreground" /> Run History
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Scheduled and manual operation records share one history, with filters scoped to this
            route.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={search.jobType}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs/runs",
                search: { ...search, page: 1, jobType: value as typeof search.jobType },
              })
            }
          >
            <SelectTrigger size="sm" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jobs</SelectItem>
              {jobTypeSchema.options.map((jobType) => (
                <SelectItem key={jobType} value={jobType}>
                  {jobTypeLabels[jobType]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={search.trigger}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs/runs",
                search: { ...search, page: 1, trigger: value as typeof search.trigger },
              })
            }
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All triggers</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={search.status}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs/runs",
                search: { ...search, page: 1, status: value as typeof search.status },
              })
            }
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={(data?.items ?? []) as CronJobRun[]}
        isLoading={isLoading}
        emptyMessage="No job runs."
        sorting={sorting}
        onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) => {
          const next = applySortingToSearch(tableSearch, updater);
          void navigate({
            to: "/jobs/runs",
            search: {
              ...search,
              page: next.page,
              sortBy: next.sortBy,
              sortDir: next.sortDir,
            },
          });
        }}
        manualSorting
        enableColumnVisibility
        pagination={
          data
            ? {
                total: data.total,
                pageIndex: pagination.pageIndex,
                pageSize: pagination.pageSize,
                pageCount,
                onPaginationChange: (updater) => {
                  const next = applyPaginationToSearch(tableSearch, updater);
                  void navigate({
                    to: "/jobs/runs",
                    search: { ...search, page: next.page, pageSize: next.pageSize },
                  });
                },
              }
            : undefined
        }
      />
    </section>
  );
}
