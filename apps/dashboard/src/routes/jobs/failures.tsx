import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Activity, AlertTriangle, Ban, CheckCircle, Eye, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { ActionIconButton } from "@/components/shared/action-icon-button";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { SourceAnomalyBadge } from "@/components/shared/security-signals";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ManualOperations } from "@/features/jobs/manual-operations";
import {
  jobsFailuresSearchDefaults,
  jobsFailuresSearchSchema,
  type JobsFailuresSearch,
} from "@/features/jobs/search";
import {
  useJobFailure,
  useJobFailures,
  useRetryJobFailure,
  useUpdateJobFailure,
} from "@/hooks/use-job-failures";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";
import {
  canRetryJobFailure,
  failureJobTypeOptions,
  getJobFailureTypeLabel,
} from "@/lib/security-signals";
import type { JobFailureListItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/jobs/failures")({
  validateSearch: jobsFailuresSearchSchema,
  search: { middlewares: [stripSearchParams(jobsFailuresSearchDefaults)] },
  component: JobsFailuresPage,
});

function JobsFailuresPage() {
  const search = Route.useSearch();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Operations
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Failure Queue</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Triage retryable failures without mixing run-history filters into the same route state.
        </p>
      </div>

      <ManualOperations />
      <FailureQueue search={search} />
    </div>
  );
}

function FailureQueue({ search }: { search: JobsFailuresSearch }) {
  const navigate = Route.useNavigate();
  const tableSearch = {
    page: search.page,
    pageSize: search.pageSize,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  };
  const pagination = paginationFromSearch(tableSearch);
  const sorting = sortingFromSearch(tableSearch);
  const selectedFailureId = search.failureId || undefined;

  const updateFailure = useUpdateJobFailure();
  const retryFailure = useRetryJobFailure();
  const selectedFailureQuery = useJobFailure(selectedFailureId);

  const { data, isLoading } = useJobFailures({
    status: search.status,
    jobType: search.jobType,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: search.sortBy,
    sortDir: search.sortDir,
  });
  const selectedFailure =
    selectedFailureQuery.data ?? data?.items.find((item) => item.id === selectedFailureId) ?? null;

  const openFailure = useCallback(
    (id: string) => {
      void navigate({ to: "/jobs/failures", search: { ...search, failureId: id } });
    },
    [navigate, search],
  );

  const closeFailure = useCallback(() => {
    void navigate({ to: "/jobs/failures", search: { ...search, failureId: "" } });
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
            value={search.status}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs/failures",
                search: { ...search, page: 1, status: value as typeof search.status },
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
            value={search.jobType}
            onValueChange={(value) =>
              void navigate({
                to: "/jobs/failures",
                search: { ...search, page: 1, jobType: value as typeof search.jobType },
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
            const next = applySortingToSearch(tableSearch, updater);
            void navigate({
              to: "/jobs/failures",
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
                    const next = applyPaginationToSearch(tableSearch, updater);
                    void navigate({
                      to: "/jobs/failures",
                      search: {
                        ...search,
                        page: next.page,
                        pageSize: next.pageSize,
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
