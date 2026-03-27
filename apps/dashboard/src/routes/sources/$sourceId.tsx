import { createFileRoute, Link } from "@tanstack/react-router";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { ArrowLeft, RefreshCw, Zap } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useParserRuns,
  useReparse,
  useSource,
  useSourceFetches,
  useSourceHealth,
  useTriggerSourceFetch,
  useUpdateSource,
} from "@/api/hooks/use-sources";
import type { ParserRun, SourceFetch } from "@/api/types";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { AppEntityLink } from "@/components/shared/entity-link";
import { HealthChart } from "@/components/shared/health-chart";
import { IdDisplay } from "@/components/shared/id-display";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/sources/$sourceId")({
  component: SourceDetailPage,
});

function SourceDetailPage() {
  const { sourceId } = Route.useParams();
  const { data: source, isLoading } = useSource(sourceId);
  const triggerFetch = useTriggerSourceFetch();
  const updateSource = useUpdateSource(sourceId);
  const [expandedFetch, setExpandedFetch] = useState<string | null>(null);
  const [fetchPagination, setFetchPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [fetchSorting, setFetchSorting] = useState<SortingState>([{ id: "fetchedAt", desc: true }]);
  const { data: fetches, isLoading: fetchesLoading } = useSourceFetches(sourceId, {
    limit: fetchPagination.pageSize,
    offset: fetchPagination.pageIndex * fetchPagination.pageSize,
    sortBy: fetchSorting[0]?.id,
    sortDir: fetchSorting[0] ? (fetchSorting[0].desc ? "desc" : "asc") : undefined,
  });
  const { data: healthData } = useSourceHealth(sourceId);
  const toggleFetch = useCallback((id: string) => {
    setExpandedFetch((current) => (current === id ? null : id));
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-64" />
      </div>
    );
  }

  if (!source) {
    return <p className="text-muted-foreground">Source not found.</p>;
  }

  return (
    <div>
      <Link
        to="/sources"
        search={{ page: 1, pageSize: 50, status: "all", type: "all" }}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Sources
      </Link>

      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              {source.label ?? source.sourceType}
            </h2>
            <StatusBadge status={source.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <IdDisplay id={source.id} />
            <span>{source.sourceType}</span>
            <span className="font-mono">{source.parserKey}</span>
          </div>
          {source.app ? (
            <div className="mt-3">
              <AppEntityLink app={source.app} showId />
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={source.status}
            onValueChange={(value) =>
              updateSource.mutate(
                { status: value },
                {
                  onSuccess: () => toast.success("Status updated"),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() =>
              triggerFetch.mutate(
                { sourceId },
                {
                  onSuccess: () => toast.success("Fetch queued"),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
            disabled={triggerFetch.isPending}
          >
            <Zap className="mr-2 h-4 w-4" />
            Trigger Fetch
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border p-4">
        <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Base URL</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">{source.baseUrl ?? "--"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Poll Interval</dt>
            <dd className="mt-0.5">{source.pollIntervalMinutes}m</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last Success</dt>
            <dd className="mt-0.5">
              <TimeAgo date={source.lastSuccessAt} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last Failure</dt>
            <dd className="mt-0.5">
              <TimeAgo date={source.lastFailureAt} />
            </dd>
          </div>
        </dl>
      </div>

      {healthData ? (
        <div className="mt-4">
          <HealthChart metrics={healthData.items} />
        </div>
      ) : null}

      <div className="mt-6">
        <div className="mb-3">
          <h3 className="text-lg font-medium">Fetch History</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Server-sorted fetch records with parser-run drilldown and page batch reparse.
          </p>
        </div>
        <FetchHistoryTable
          sourceId={sourceId}
          fetches={fetches?.items ?? []}
          isLoading={fetchesLoading}
          expandedFetch={expandedFetch}
          onToggleFetch={toggleFetch}
          sorting={fetchSorting}
          onSortingChange={setFetchSorting}
          pagination={
            fetches
              ? {
                  total: fetches.total,
                  pageIndex: fetchPagination.pageIndex,
                  pageSize: fetchPagination.pageSize,
                  pageCount: Math.max(1, Math.ceil(fetches.total / fetchPagination.pageSize)),
                  onPaginationChange: setFetchPagination,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

function FetchHistoryTable({
  sourceId,
  fetches,
  isLoading,
  expandedFetch,
  onToggleFetch,
  sorting,
  onSortingChange,
  pagination,
}: {
  sourceId: string;
  fetches: SourceFetch[];
  isLoading: boolean;
  expandedFetch: string | null;
  onToggleFetch: (id: string) => void;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
  pagination?: {
    total: number;
    pageIndex: number;
    pageSize: number;
    pageCount: number;
    onPaginationChange: (
      updater: PaginationState | ((prev: PaginationState) => PaginationState),
    ) => void;
  };
}) {
  const reparse = useReparse();

  const queueReparse = useCallback(
    (fetchId: string) => {
      reparse.mutate(fetchId, {
        onSuccess: () => toast.success("Reparse queued"),
        onError: (error) => toast.error(error.message),
      });
    },
    [reparse],
  );

  const columns = useMemo<ColumnDef<SourceFetch>[]>(
    () => [
      {
        accessorKey: "fetchStatus",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.fetchStatus} />,
      },
      {
        accessorKey: "httpStatus",
        meta: { label: "HTTP" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="HTTP" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.httpStatus ?? "--"}</span>
        ),
      },
      {
        accessorKey: "contentType",
        meta: { label: "Content" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Content" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1 text-xs">
            <span className="truncate">{row.original.contentType ?? "--"}</span>
            <span className="text-muted-foreground">
              {row.original.contentLength != null ? `${row.original.contentLength} bytes` : "--"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "contentHash",
        meta: { label: "Hash" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Hash" />,
        cell: ({ row }) =>
          row.original.contentHash ? (
            <span className="font-mono text-xs">{row.original.contentHash.slice(0, 12)}...</span>
          ) : (
            "--"
          ),
      },
      {
        accessorKey: "errorMessage",
        meta: { label: "Error" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Error" />,
        cell: ({ row }) =>
          row.original.errorMessage ? (
            <span className="block max-w-64 truncate text-xs text-red-600 dark:text-red-400">
              {row.original.errorMessage}
            </span>
          ) : (
            "--"
          ),
      },
      {
        accessorKey: "fetchedAt",
        meta: { label: "Fetched" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fetched" />,
        cell: ({ row }) => <TimeAgo date={row.original.fetchedAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onToggleFetch(row.original.id)}>
              {expandedFetch === row.original.id ? "Hide Runs" : "Parser Runs"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => queueReparse(row.original.id)}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Reparse
            </Button>
          </div>
        ),
      },
    ],
    [expandedFetch, onToggleFetch, queueReparse],
  );

  const bulkActions: BulkAction<SourceFetch>[] = [
    {
      label: "Reparse Selected",
      onClick: async (rows) => {
        for (const row of rows) {
          queueReparse(row.id);
        }
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        columns={columns}
        data={fetches}
        isLoading={isLoading}
        emptyMessage="No fetch history."
        sorting={sorting}
        onSortingChange={onSortingChange}
        manualSorting
        enableColumnVisibility
        enableRowSelection
        bulkActions={bulkActions}
        pagination={pagination}
      />
      {expandedFetch ? <ParserRunsPanel fetchId={expandedFetch} sourceId={sourceId} /> : null}
    </div>
  );
}

function ParserRunsPanel({ fetchId, sourceId }: { fetchId: string; sourceId: string }) {
  const { data, isLoading } = useParserRuns(fetchId);

  const columns = useMemo<ColumnDef<ParserRun>[]>(
    () => [
      {
        accessorKey: "runStatus",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.runStatus} />,
      },
      {
        accessorKey: "parserKey",
        meta: { label: "Parser" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Parser" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.parserKey}</span>,
      },
      {
        accessorKey: "observationCount",
        meta: { label: "Observations" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Observations" />,
        cell: ({ row }) => row.original.observationCount,
      },
      {
        accessorKey: "confidence",
        meta: { label: "Confidence" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Confidence" />,
        cell: ({ row }) => (row.original.confidence != null ? `${row.original.confidence}%` : "--"),
      },
      {
        accessorKey: "finishedAt",
        meta: { label: "Finished" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Finished" />,
        cell: ({ row }) => <TimeAgo date={row.original.finishedAt} />,
      },
      {
        id: "duration",
        meta: { label: "Duration" },
        enableSorting: false,
        cell: ({ row }) => {
          if (!row.original.finishedAt) {
            return "--";
          }

          const durationMs =
            new Date(row.original.finishedAt).getTime() -
            new Date(row.original.startedAt).getTime();

          return `${Math.max(0, durationMs)}ms`;
        },
      },
      {
        accessorKey: "errorMessage",
        meta: { label: "Error" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Error" />,
        cell: ({ row }) =>
          row.original.errorMessage ? (
            <span className="block max-w-64 truncate text-xs text-red-600 dark:text-red-400">
              {row.original.errorMessage}
            </span>
          ) : (
            "--"
          ),
      },
    ],
    [],
  );

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-medium">Parser Runs</h4>
        <span className="text-xs text-muted-foreground">Fetch {fetchId.slice(0, 15)}...</span>
        <span className="text-xs text-muted-foreground">Source {sourceId.slice(0, 15)}...</span>
      </div>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        emptyMessage="No parser runs."
        enableColumnVisibility
      />
    </div>
  );
}
