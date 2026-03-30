import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Ban, CheckCircle, Loader2, MoreHorizontal, Package, Radio, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useJobFailures,
  useRetryJobFailure,
  useUpdateJobFailure,
} from "@/api/hooks/use-job-failures";
import { useCronJobRuns, useTriggerCaskSync, useTriggerPollSources } from "@/api/hooks/use-jobs";
import type { JobFailureListItem } from "@/api/types";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const jobsSearchSchema = z.object({
  ...paginatedSearchShape,
  tab: z.enum(["runs", "failures"]).catch("runs"),
  jobType: z
    .enum(["all", "poll_sources", "cask_index_sync", "enrich_discovered_apps"])
    .catch("all"),
  failureStatus: z.enum(["open", "retrying", "resolved", "abandoned"]).catch("open"),
});

export const Route = createFileRoute("/jobs/")({
  validateSearch: (search) => jobsSearchSchema.parse(search),
  component: JobsPage,
});

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

interface CronJobRun {
  id: string;
  jobType: "poll_sources" | "cask_index_sync" | "enrich_discovered_apps";
  trigger: "manual" | "scheduled";
  status: "running" | "completed" | "failed";
  actorId: string | null;
  itemsQueued: number | null;
  itemsTotal: number | null;
  resultJson: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

const jobTypeLabels: Record<string, string> = {
  poll_sources: "Poll Sources",
  cask_index_sync: "Cask Index Sync",
  enrich_discovered_apps: "Enrich Discoveries",
};

import { formatDuration } from "@/lib/format-duration";

// ---------------------------------------------------------------------------
// Root page
// ---------------------------------------------------------------------------

function JobsPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Jobs</h2>
      <p className="mt-1 text-muted-foreground">
        Trigger jobs, view run history, and manage failures.
      </p>

      <Tabs
        value={search.tab}
        onValueChange={(tab) =>
          void navigate({
            to: "/jobs",
            search: { ...search, tab: tab as "runs" | "failures", page: 1 },
          })
        }
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="failures">Failures</TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <RunsTab />
        </TabsContent>
        <TabsContent value="failures">
          <FailuresTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runs tab
// ---------------------------------------------------------------------------

function RunsTab() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const pagination = paginationFromSearch(search);
  const sorting = sortingFromSearch(search);
  const [forcePolling, setForcePolling] = useState(false);

  const pollSources = useTriggerPollSources();
  const caskSync = useTriggerCaskSync();

  const { data, isLoading } = useCronJobRuns({
    jobType: search.jobType === "all" ? undefined : search.jobType,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  });

  const handlePollSources = useCallback(() => {
    pollSources.mutate(
      { force: forcePolling },
      {
        onSuccess: (result) =>
          toast.success(
            `Queued ${result.itemsQueued} of ${result.itemsTotal} sources for fetching`,
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  }, [pollSources, forcePolling]);

  const handleCaskSync = useCallback(() => {
    caskSync.mutate(undefined, {
      onSuccess: () => toast.success("Cask index sync started"),
      onError: (err) => toast.error(err.message),
    });
  }, [caskSync]);

  const columns = useMemo<ColumnDef<CronJobRun>[]>(
    () => [
      {
        accessorKey: "jobType",
        meta: { label: "Job Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Job Type" />,
        cell: ({ row }) => (
          <Badge variant="secondary">
            {jobTypeLabels[row.original.jobType] ?? row.original.jobType}
          </Badge>
        ),
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
        id: "actor",
        meta: { label: "Actor" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Actor" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.actorId ?? "System"}</span>
        ),
      },
    ],
    [],
  );

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handlePollSources} disabled={pollSources.isPending}>
            {pollSources.isPending ? <Loader2 className="animate-spin" /> : <Radio />}
            Poll Sources
          </Button>
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="force-poll"
              checked={forcePolling}
              onCheckedChange={(checked) => setForcePolling(checked === true)}
            />
            <Label htmlFor="force-poll" className="text-xs text-muted-foreground">
              Force
            </Label>
          </div>
        </div>

        <Button size="sm" onClick={handleCaskSync} disabled={caskSync.isPending}>
          {caskSync.isPending ? <Loader2 className="animate-spin" /> : <Package />}
          Cask Index Sync
        </Button>

        <div className="ml-auto">
          <Select
            value={search.jobType}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs",
                search: { ...search, page: 1, jobType: value as typeof search.jobType },
              })
            }
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Job Types</SelectItem>
              <SelectItem value="poll_sources">Poll Sources</SelectItem>
              <SelectItem value="cask_index_sync">Cask Index Sync</SelectItem>
              <SelectItem value="enrich_discovered_apps">Enrich Discoveries</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        emptyMessage="No job runs."
        sorting={sorting}
        onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
          void navigate({ to: "/jobs", search: applySortingToSearch(search, updater) })
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
                  void navigate({ to: "/jobs", search: applyPaginationToSearch(search, updater) }),
              }
            : undefined
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Failures tab
// ---------------------------------------------------------------------------

function FailuresTab() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const pagination = paginationFromSearch(search);
  const sorting = sortingFromSearch(search);
  const [selectedFailure, setSelectedFailure] = useState<JobFailureListItem | null>(null);

  const updateFailure = useUpdateJobFailure();
  const retryFailure = useRetryJobFailure();

  const { data, isLoading } = useJobFailures({
    status: search.failureStatus,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
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
        cell: ({ row }) => <Badge variant="secondary">{row.original.jobType}</Badge>,
      },
      {
        id: "relatedRef",
        meta: { label: "Related" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Related" />,
        cell: ({ row }) => <EntityReferenceLink refItem={row.original.relatedRef} />,
      },
      {
        id: "errorMessage",
        meta: { label: "Error" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Error" />,
        cell: ({ row }) =>
          row.original.errorMessage ? (
            <button
              type="button"
              className="block max-w-56 cursor-pointer truncate text-left text-xs text-red-600 dark:text-red-400"
              onClick={() => setSelectedFailure(row.original)}
            >
              {row.original.errorMessage}
            </button>
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
        meta: { label: "" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.status === "open" || row.original.status === "retrying" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleRetry(row.original.id)}>
                  <RefreshCw />
                  Retry
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange(row.original.id, "resolved")}>
                  <CheckCircle />
                  Resolve
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange(row.original.id, "abandoned")}>
                  <Ban />
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
        for (const row of rows) handleRetry(row.id);
      },
    },
    {
      label: "Resolve Selected",
      onClick: async (rows) => {
        for (const row of rows) handleStatusChange(row.id, "resolved");
      },
    },
    {
      label: "Abandon Selected",
      variant: "destructive",
      onClick: async (rows) => {
        for (const row of rows) handleStatusChange(row.id, "abandoned");
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <Select
          value={search.failureStatus}
          onValueChange={(value) =>
            void navigate({
              to: "/jobs",
              search: { ...search, page: 1, failureStatus: value as typeof search.failureStatus },
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

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        emptyMessage="No job failures."
        sorting={sorting}
        onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
          void navigate({ to: "/jobs", search: applySortingToSearch(search, updater) })
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
                  void navigate({ to: "/jobs", search: applyPaginationToSearch(search, updater) }),
              }
            : undefined
        }
      />

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
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-red-50 p-3 font-mono text-xs text-red-800 dark:bg-red-900/30 dark:text-red-300">
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
