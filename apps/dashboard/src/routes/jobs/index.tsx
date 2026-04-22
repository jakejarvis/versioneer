import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Ban, CheckCircle, Eye, Package, Radio, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ActionIconButton } from "@/components/shared/action-icon-button";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { SourceAnomalyBadge } from "@/components/shared/security-signals";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useJobFailure,
  useJobFailures,
  useRetryJobFailure,
  useUpdateJobFailure,
} from "@/hooks/use-job-failures";
import { useCronJobRuns, useTriggerCaskSync, useTriggerPollSources } from "@/hooks/use-jobs";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchDefaults,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";
import { formatDuration } from "@/lib/format-duration";
import {
  canRetryJobFailure,
  failureJobTypeOptions,
  getJobFailureTypeLabel,
} from "@/lib/security-signals";
import type { JobFailureListItem } from "@/lib/types";

const jobsSearchDefaults = {
  ...paginatedSearchDefaults,
  tab: "runs" as const,
  jobType: "all" as const,
  failureJobType: "all" as const,
  failureStatus: "open" as const,
  failureId: "",
};

const jobsSearchSchema = z.object({
  ...paginatedSearchShape,
  tab: z.enum(["runs", "failures"]).default(jobsSearchDefaults.tab).catch(jobsSearchDefaults.tab),
  jobType: z
    .enum(["all", "poll_sources", "cask_index_sync", "enrich_discovered_apps"])
    .default(jobsSearchDefaults.jobType)
    .catch(jobsSearchDefaults.jobType),
  failureJobType: z
    .enum([
      "all",
      "source-anomaly",
      "source-fetch",
      "source-parse",
      "recompute-latest",
      "poll_sources",
      "cask_index_sync",
      "enrich_discovered_apps",
    ])
    .default(jobsSearchDefaults.failureJobType)
    .catch(jobsSearchDefaults.failureJobType),
  failureStatus: z
    .enum(["open", "retrying", "resolved", "abandoned"])
    .default(jobsSearchDefaults.failureStatus)
    .catch(jobsSearchDefaults.failureStatus),
  failureId: z.string().default(jobsSearchDefaults.failureId).catch(jobsSearchDefaults.failureId),
});

export const Route = createFileRoute("/jobs/")({
  validateSearch: jobsSearchSchema,
  search: { middlewares: [stripSearchParams(jobsSearchDefaults)] },
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

// ---------------------------------------------------------------------------
// Root page
// ---------------------------------------------------------------------------

function JobsPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const activeTab = search.failureId ? "failures" : search.tab;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Jobs</h2>
      <p className="mt-1 text-muted-foreground">
        Trigger jobs, view run history, and manage failures.
      </p>

      <Tabs
        value={activeTab}
        onValueChange={(tab) =>
          void navigate({
            to: "/jobs",
            search: {
              ...search,
              tab: tab as "runs" | "failures",
              page: 1,
              failureId: tab === "failures" ? search.failureId : "",
            },
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
            {pollSources.isPending ? <Spinner /> : <Radio />}
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
          {caskSync.isPending ? <Spinner /> : <Package />}
          Cask Index Sync
        </Button>

        <div className="w-full sm:ml-auto sm:w-auto">
          <Select
            value={search.jobType}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs",
                search: { ...search, page: 1, jobType: value as typeof search.jobType },
              })
            }
          >
            <SelectTrigger size="sm" className="w-full sm:w-44">
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
  const selectedFailureId = search.failureId || undefined;

  const updateFailure = useUpdateJobFailure();
  const retryFailure = useRetryJobFailure();
  const selectedFailureQuery = useJobFailure(selectedFailureId);

  const { data, isLoading } = useJobFailures({
    status: search.failureStatus,
    jobType: search.failureJobType === "all" ? undefined : search.failureJobType,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  });
  const selectedFailure =
    selectedFailureQuery.data ?? data?.items.find((item) => item.id === selectedFailureId) ?? null;

  const openFailure = useCallback(
    (id: string) => {
      void navigate({ to: "/jobs", search: { ...search, tab: "failures", failureId: id } });
    },
    [navigate, search],
  );

  const closeFailure = useCallback(() => {
    void navigate({ to: "/jobs", search: { ...search, tab: "failures", failureId: "" } });
  }, [navigate, search]);

  const handleRetry = useCallback(
    (id: string) => {
      retryFailure.mutate(id, {
        onSuccess: (result) =>
          result.count > 0
            ? toast.success("Job re-enqueued")
            : toast.info("This failure is informational; resolve or abandon it."),
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
        cell: ({ row }) =>
          row.original.jobType === "source-anomaly" ? (
            <SourceAnomalyBadge jobKey={row.original.jobKey} />
          ) : (
            <Badge variant="secondary">
              {getJobFailureTypeLabel(row.original.jobType, row.original.jobKey)}
            </Badge>
          ),
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
              onClick={() => openFailure(row.original.id)}
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
        cell: ({ row }) => {
          const canUpdate = row.original.status === "open" || row.original.status === "retrying";
          return (
            <div className="flex items-center justify-end gap-1">
              <ActionIconButton
                label="View details"
                icon={Eye}
                onClick={() => openFailure(row.original.id)}
              />
              {canUpdate && canRetryJobFailure(row.original.jobType) ? (
                <ActionIconButton
                  label="Retry"
                  icon={RefreshCw}
                  onClick={() => handleRetry(row.original.id)}
                />
              ) : null}
              {canUpdate ? (
                <>
                  <ActionIconButton
                    label="Resolve"
                    icon={CheckCircle}
                    onClick={() => handleStatusChange(row.original.id, "resolved")}
                  />
                  <ActionIconButton
                    label="Abandon"
                    icon={Ban}
                    onClick={() => handleStatusChange(row.original.id, "abandoned")}
                  />
                </>
              ) : null}
            </div>
          );
        },
      },
    ],
    [handleRetry, handleStatusChange, openFailure],
  );

  const bulkActions: BulkAction<JobFailureListItem>[] = [
    {
      label: "Retry Selected",
      onClick: async (rows) => {
        const retryable = rows.filter((row) => canRetryJobFailure(row.jobType));
        if (retryable.length === 0) {
          toast.info("Selected failures are informational; resolve or abandon them.");
          return;
        }
        for (const row of retryable) handleRetry(row.id);
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
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={search.failureStatus}
          onValueChange={(value) =>
            void navigate({
              to: "/jobs",
              search: { ...search, page: 1, failureStatus: value as typeof search.failureStatus },
            })
          }
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="retrying">Retrying</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={search.failureJobType}
          onValueChange={(value) =>
            void navigate({
              to: "/jobs",
              search: {
                ...search,
                page: 1,
                failureJobType: value as typeof search.failureJobType,
              },
            })
          }
        >
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {failureJobTypeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
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

      <Dialog open={Boolean(selectedFailureId)} onOpenChange={(open) => !open && closeFailure()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Error Detail</DialogTitle>
          </DialogHeader>
          {selectedFailureQuery.isLoading && !selectedFailure ? (
            <div className="text-sm text-muted-foreground">Loading failure detail...</div>
          ) : selectedFailure ? (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Job Type: </span>
                {getJobFailureTypeLabel(selectedFailure.jobType, selectedFailure.jobKey)}
              </div>
              {selectedFailure.jobType === "source-anomaly" ? (
                <div className="text-sm">
                  <span className="text-muted-foreground">Signal: </span>
                  <SourceAnomalyBadge jobKey={selectedFailure.jobKey} />
                </div>
              ) : null}
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
          ) : (
            <div className="text-sm text-muted-foreground">Job failure not found.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
