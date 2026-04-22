import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle,
  Clock3,
  Eye,
  Package,
  Radio,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  useJobFailure,
  useJobFailures,
  useRetryJobFailure,
  useUpdateJobFailure,
} from "@/hooks/use-job-failures";
import {
  useCronJobRuns,
  useTriggerCaskSync,
  useTriggerEnrichDiscoveries,
  useTriggerPollSources,
} from "@/hooks/use-jobs";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchDefaults,
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
import { cn } from "@/lib/utils";

const pageSizeSchema = z
  .union([z.literal(25), z.literal(50), z.literal(100)])
  .default(paginatedSearchDefaults.pageSize)
  .catch(paginatedSearchDefaults.pageSize);
const pageSchema = z.coerce.number().int().min(1).default(1).catch(1);
const sortDirSchema = z.enum(["asc", "desc"]).optional();
const jobTypeSchema = z.enum(["poll_sources", "cask_index_sync", "enrich_discovered_apps"]);
const runJobTypeFilterSchema = z.enum([
  "all",
  "poll_sources",
  "cask_index_sync",
  "enrich_discovered_apps",
]);
const runTriggerFilterSchema = z.enum(["all", "manual", "scheduled"]);
const runStatusFilterSchema = z.enum(["all", "running", "completed", "failed"]);
const failureStatusSchema = z.enum(["open", "retrying", "resolved", "abandoned"]);
const failureJobTypeSchema = z.enum([
  "all",
  "source-anomaly",
  "source-fetch",
  "source-parse",
  "recompute-latest",
  "poll_sources",
  "cask_index_sync",
  "enrich_discovered_apps",
]);

const jobsSearchDefaults = {
  runPage: 1,
  runPageSize: paginatedSearchDefaults.pageSize,
  runJobType: "all" as const,
  runTrigger: "all" as const,
  runStatus: "all" as const,
  failurePage: 1,
  failurePageSize: paginatedSearchDefaults.pageSize,
  failureJobType: "all" as const,
  failureStatus: "open" as const,
  failureId: "",
};

const jobsSearchSchema = z.object({
  runPage: pageSchema.default(jobsSearchDefaults.runPage).catch(jobsSearchDefaults.runPage),
  runPageSize: pageSizeSchema,
  runSortBy: z.string().optional(),
  runSortDir: sortDirSchema,
  runJobType: runJobTypeFilterSchema
    .default(jobsSearchDefaults.runJobType)
    .catch(jobsSearchDefaults.runJobType),
  runTrigger: runTriggerFilterSchema
    .default(jobsSearchDefaults.runTrigger)
    .catch(jobsSearchDefaults.runTrigger),
  runStatus: runStatusFilterSchema
    .default(jobsSearchDefaults.runStatus)
    .catch(jobsSearchDefaults.runStatus),
  failurePage: pageSchema
    .default(jobsSearchDefaults.failurePage)
    .catch(jobsSearchDefaults.failurePage),
  failurePageSize: pageSizeSchema,
  failureSortBy: z.string().optional(),
  failureSortDir: sortDirSchema,
  failureJobType: failureJobTypeSchema
    .default(jobsSearchDefaults.failureJobType)
    .catch(jobsSearchDefaults.failureJobType),
  failureStatus: failureStatusSchema
    .default(jobsSearchDefaults.failureStatus)
    .catch(jobsSearchDefaults.failureStatus),
  failureId: z.string().default(jobsSearchDefaults.failureId).catch(jobsSearchDefaults.failureId),
  tab: z.enum(["runs", "failures"]).optional(),
  jobType: runJobTypeFilterSchema.optional(),
});

type JobsSearch = z.infer<typeof jobsSearchSchema>;

export const Route = createFileRoute("/jobs/")({
  validateSearch: jobsSearchSchema,
  search: { middlewares: [stripSearchParams(jobsSearchDefaults)] },
  component: JobsPage,
});

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

const jobTypeLabels: Record<CronJobRun["jobType"], string> = {
  poll_sources: "Poll Sources",
  cask_index_sync: "Cask Index Sync",
  enrich_discovered_apps: "Enrich Discoveries",
};

function JobsPage() {
  const search = Route.useSearch();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Operations
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Jobs Command Center</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Run manual operations, monitor scheduled work, and triage retryable failures from one
          place.
        </p>
      </div>

      <ManualOperations />
      <RunHistory search={search} />
      <FailureQueue search={search} />
    </div>
  );
}

function ManualOperations() {
  const [forcePolling, setForcePolling] = useState(false);
  const pollSources = useTriggerPollSources();
  const caskSync = useTriggerCaskSync();
  const enrichDiscoveries = useTriggerEnrichDiscoveries();
  const recentRuns = useCronJobRuns({ limit: 12 });
  const openFailures = useJobFailures({ status: "open", limit: 5 });

  const latestRuns = recentRuns.data?.items ?? [];
  const latestFor = (jobType: CronJobRun["jobType"]) =>
    latestRuns.find((run) => run.jobType === jobType) as CronJobRun | undefined;

  const handlePollSources = useCallback(() => {
    pollSources.mutate(
      { force: forcePolling },
      {
        onSuccess: (result) => {
          const message =
            result.status === "failed"
              ? `Queued ${result.itemsQueued} of ${result.itemsTotal} sources; ${result.failedCount} failed`
              : `Queued ${result.itemsQueued} of ${result.itemsTotal} sources`;
          (result.status === "failed" ? toast.warning : toast.success)(message);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }, [forcePolling, pollSources]);

  const handleCaskSync = useCallback(() => {
    caskSync.mutate(undefined, {
      onSuccess: () => toast.success("Cask index sync completed"),
      onError: (err) => toast.error(err.message),
    });
  }, [caskSync]);

  const handleEnrichDiscoveries = useCallback(() => {
    enrichDiscoveries.mutate(undefined, {
      onSuccess: () => toast.success("Discovery enrichment drain started"),
      onError: (err) => toast.error(err.message),
    });
  }, [enrichDiscoveries]);

  return (
    <section className="rounded-2xl border bg-muted/20 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Manual Operations</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            These actions match real backend jobs and write to run history.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          {openFailures.data?.total ?? 0} open failures
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <OperationCard
          title="Poll Sources"
          description="Queue fetch workflows for active sources that are due, or force all active sources."
          icon={Radio}
          latestRun={latestFor("poll_sources")}
          action={
            <div className="flex flex-wrap items-center gap-3">
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
                  Force all
                </Label>
              </div>
            </div>
          }
        />
        <OperationCard
          title="Cask Index Sync"
          description="Refresh the Homebrew Cask index cache and resolve cask metadata."
          icon={Package}
          latestRun={latestFor("cask_index_sync")}
          action={
            <Button size="sm" onClick={handleCaskSync} disabled={caskSync.isPending}>
              {caskSync.isPending ? <Spinner /> : <Package />}
              Sync Casks
            </Button>
          }
        />
        <OperationCard
          title="Enrich Discoveries"
          description="Start a background workflow that drains eligible discovered-app enrichment work."
          icon={Sparkles}
          latestRun={latestFor("enrich_discovered_apps")}
          action={
            <Button
              size="sm"
              onClick={handleEnrichDiscoveries}
              disabled={enrichDiscoveries.isPending}
            >
              {enrichDiscoveries.isPending ? <Spinner /> : <Sparkles />}
              Drain Backlog
            </Button>
          }
        />
      </div>
    </section>
  );
}

function OperationCard({
  title,
  description,
  icon: Icon,
  latestRun,
  action,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  latestRun?: CronJobRun;
  action: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col justify-between rounded-xl border bg-background p-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
          {latestRun ? (
            <StatusBadge status={latestRun.status} />
          ) : (
            <Badge variant="outline">No runs</Badge>
          )}
        </div>
        <h4 className="mt-4 font-medium">{title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        <div className="mt-3 text-xs text-muted-foreground">
          {latestRun ? (
            <span>
              Last {latestRun.trigger} run <TimeAgo date={latestRun.startedAt} />
            </span>
          ) : (
            "No recent run recorded."
          )}
        </div>
      </div>
      <div className="mt-4">{action}</div>
    </div>
  );
}

function RunHistory({ search }: { search: JobsSearch }) {
  const navigate = Route.useNavigate();
  const runTableSearch = {
    page: search.runPage,
    pageSize: search.runPageSize,
    sortBy: search.runSortBy,
    sortDir: search.runSortDir,
  };
  const pagination = paginationFromSearch(runTableSearch);
  const sorting = sortingFromSearch(runTableSearch);
  const activeRunJobType =
    search.runJobType === "all" && search.jobType ? search.jobType : search.runJobType;

  const { data, isLoading } = useCronJobRuns({
    jobType: activeRunJobType === "all" ? undefined : activeRunJobType,
    trigger: search.runTrigger === "all" ? undefined : search.runTrigger,
    status: search.runStatus === "all" ? undefined : search.runStatus,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: search.runSortBy,
    sortDir: search.runSortDir,
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
            table.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={activeRunJobType}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs",
                search: { ...search, runPage: 1, runJobType: value as typeof search.runJobType },
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
            value={search.runTrigger}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs",
                search: { ...search, runPage: 1, runTrigger: value as typeof search.runTrigger },
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
            value={search.runStatus}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs",
                search: { ...search, runPage: 1, runStatus: value as typeof search.runStatus },
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
          const next = applySortingToSearch(runTableSearch, updater);
          void navigate({
            to: "/jobs",
            search: {
              ...search,
              runPage: next.page,
              runSortBy: next.sortBy,
              runSortDir: next.sortDir,
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
                  const next = applyPaginationToSearch(runTableSearch, updater);
                  void navigate({
                    to: "/jobs",
                    search: { ...search, runPage: next.page, runPageSize: next.pageSize },
                  });
                },
              }
            : undefined
        }
      />
    </section>
  );
}

function FailureQueue({ search }: { search: JobsSearch }) {
  const navigate = Route.useNavigate();
  const failureTableSearch = {
    page: search.failurePage,
    pageSize: search.failurePageSize,
    sortBy: search.failureSortBy,
    sortDir: search.failureSortDir,
  };
  const pagination = paginationFromSearch(failureTableSearch);
  const sorting = sortingFromSearch(failureTableSearch);
  const selectedFailureId = search.failureId || undefined;

  const updateFailure = useUpdateJobFailure();
  const retryFailure = useRetryJobFailure();
  const selectedFailureQuery = useJobFailure(selectedFailureId);

  const { data, isLoading } = useJobFailures({
    status: search.failureStatus,
    jobType: search.failureJobType === "all" ? undefined : search.failureJobType,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: search.failureSortBy,
    sortDir: search.failureSortDir,
  });
  const selectedFailure =
    selectedFailureQuery.data ?? data?.items.find((item) => item.id === selectedFailureId) ?? null;

  const openFailure = useCallback(
    (id: string) => {
      void navigate({ to: "/jobs", search: { ...search, failureId: id } });
    },
    [navigate, search],
  );

  const closeFailure = useCallback(() => {
    void navigate({ to: "/jobs", search: { ...search, failureId: "" } });
  }, [navigate, search]);

  const handleRetry = useCallback(
    (id: string) => {
      retryFailure.mutate(id, {
        onSuccess: (result) =>
          result.count > 0
            ? toast.success(result.status === "resolved" ? "Job retried" : "Job retry started")
            : toast.info("This failure cannot be retried automatically."),
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
        meta: { label: "Failure" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Failure" />,
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
              className="block max-w-64 cursor-pointer truncate text-left text-xs text-red-600 dark:text-red-400"
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
          toast.info("Selected failures cannot be retried automatically.");
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
    <section className="space-y-4 rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" /> Failure Queue
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Retry operational failures, resolve stale noise, and inspect the exact error.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={search.failureStatus}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs",
                search: {
                  ...search,
                  failurePage: 1,
                  failureStatus: value as typeof search.failureStatus,
                },
              })
            }
          >
            <SelectTrigger size="sm" className="w-36">
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
                  failurePage: 1,
                  failureJobType: value as typeof search.failureJobType,
                },
              })
            }
          >
            <SelectTrigger size="sm" className="w-52">
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
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No job failures."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) => {
            const next = applySortingToSearch(failureTableSearch, updater);
            void navigate({
              to: "/jobs",
              search: {
                ...search,
                failurePage: next.page,
                failureSortBy: next.sortBy,
                failureSortDir: next.sortDir,
              },
            });
          }}
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
                  onPaginationChange: (updater) => {
                    const next = applyPaginationToSearch(failureTableSearch, updater);
                    void navigate({
                      to: "/jobs",
                      search: {
                        ...search,
                        failurePage: next.page,
                        failurePageSize: next.pageSize,
                      },
                    });
                  },
                }
              : undefined
          }
        />

        <FailureInspector
          failure={selectedFailure}
          isLoading={selectedFailureQuery.isLoading && Boolean(selectedFailureId)}
          onClose={closeFailure}
          className={cn(!selectedFailureId && "hidden xl:block")}
        />
      </div>
    </section>
  );
}

function FailureInspector({
  failure,
  isLoading,
  onClose,
  className,
}: {
  failure: JobFailureListItem | null;
  isLoading: boolean;
  onClose: () => void;
  className?: string;
}) {
  return (
    <aside className={cn("rounded-xl border bg-muted/20 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium">Failure Inspector</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Deep-linked failure details stay scoped here.
          </p>
        </div>
        {failure ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Clear
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading failure detail...
        </div>
      ) : failure ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {failure.jobType === "source-anomaly" ? (
              <SourceAnomalyBadge jobKey={failure.jobKey} />
            ) : (
              <Badge variant="secondary">
                {getJobFailureTypeLabel(failure.jobType, failure.jobKey)}
              </Badge>
            )}
            <StatusBadge status={failure.status} />
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Related</dt>
              <dd className="mt-1">
                <EntityReferenceLink refItem={failure.relatedRef} />
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Job key</dt>
              <dd className="mt-1 font-mono text-xs">{failure.jobKey ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Retries</dt>
              <dd className="mt-1">{failure.retryCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created</dt>
              <dd className="mt-1">
                <TimeAgo date={failure.createdAt} />
              </dd>
            </div>
          </dl>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Error</div>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-red-50 p-3 font-mono text-xs text-red-800 dark:bg-red-900/30 dark:text-red-300">
              {failure.errorMessage ?? "No error message recorded."}
            </pre>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Select a failure row to inspect its error, related entity, retry count, and job key.
        </div>
      )}
    </aside>
  );
}
