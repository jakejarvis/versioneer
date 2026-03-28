import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Loader2, Radio, RefreshCw, Package } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useCronJobRuns,
  useTriggerCaskSync,
  useTriggerPollSources,
  useTriggerRecomputeScorecards,
} from "@/api/hooks/use-jobs";
import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
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
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const jobsSearchSchema = z.object({
  ...paginatedSearchShape,
  jobType: z.enum(["all", "poll_sources", "recompute_scorecards", "cask_index_sync"]).catch("all"),
});

export const Route = createFileRoute("/jobs/")({
  validateSearch: (search) => jobsSearchSchema.parse(search),
  component: JobsPage,
});

interface CronJobRun {
  id: string;
  jobType: "poll_sources" | "recompute_scorecards" | "cask_index_sync";
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
  recompute_scorecards: "Recompute Scorecards",
  cask_index_sync: "Cask Index Sync",
};

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "--";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function JobsPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const [forcePolling, setForcePolling] = useState(false);

  const pollSources = useTriggerPollSources();
  const recomputeScorecards = useTriggerRecomputeScorecards();
  const caskSync = useTriggerCaskSync();

  const { data, isLoading } = useCronJobRuns({
    jobType: searchState.jobType === "all" ? undefined : searchState.jobType,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
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

  const handleRecomputeScorecards = useCallback(() => {
    recomputeScorecards.mutate(undefined, {
      onSuccess: (result) =>
        toast.success(`Queued ${result.itemsQueued} apps for scorecard recomputation`),
      onError: (err) => toast.error(err.message),
    });
  }, [recomputeScorecards]);

  const handleCaskSync = useCallback(() => {
    caskSync.mutate(undefined, {
      onSuccess: () => toast.success("Cask index sync queued"),
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
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {jobTypeLabels[row.original.jobType] ?? row.original.jobType}
          </span>
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
        cell: ({ row }) => formatDuration(row.original.startedAt, row.original.completedAt),
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
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Jobs</h2>
      <p className="mt-1 text-muted-foreground">Trigger cron jobs and view run history.</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
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

        <Button
          size="sm"
          onClick={handleRecomputeScorecards}
          disabled={recomputeScorecards.isPending}
        >
          {recomputeScorecards.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Recompute Scorecards
        </Button>

        <Button size="sm" onClick={handleCaskSync} disabled={caskSync.isPending}>
          {caskSync.isPending ? <Loader2 className="animate-spin" /> : <Package />}
          Cask Index Sync
        </Button>
      </div>

      <div className="mt-4">
        <Select
          value={searchState.jobType}
          onValueChange={(value) =>
            void navigate({
              to: "/jobs",
              search: {
                ...searchState,
                page: 1,
                jobType: value as typeof searchState.jobType,
              },
            })
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Job Types</SelectItem>
            <SelectItem value="poll_sources">Poll Sources</SelectItem>
            <SelectItem value="recompute_scorecards">Recompute Scorecards</SelectItem>
            <SelectItem value="cask_index_sync">Cask Index Sync</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No job runs recorded yet."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/jobs",
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
                      to: "/jobs",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
