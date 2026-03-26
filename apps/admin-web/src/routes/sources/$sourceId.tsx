import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Zap, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  useSource,
  useSourceFetches,
  useSourceHealth,
  useParserRuns,
  useTriggerSourceFetch,
  useUpdateSource,
  useReparse,
} from "@/api/hooks/use-sources";
import type { SourceFetch, ParserRun } from "@/api/types";
import { DataTable, type Column } from "@/components/shared/data-table";
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
  const [fetchOffset, setFetchOffset] = useState(0);
  const { data: fetches, isLoading: fetchesLoading } = useSourceFetches(sourceId, {
    limit: 20,
    offset: fetchOffset,
  });
  const [expandedFetch, setExpandedFetch] = useState<string | null>(null);
  const { data: healthData } = useSourceHealth(sourceId);

  if (isLoading) {
    return (
      <div className="space-y-4">
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
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Sources
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              {source.label ?? source.sourceType}
            </h2>
            <StatusBadge status={source.status} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <IdDisplay id={source.id} />
            <span>{source.sourceType}</span>
            <span className="font-mono">{source.parserKey}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={source.status}
            onValueChange={(v) =>
              updateSource.mutate(
                { status: v },
                {
                  onSuccess: () => toast.success("Status updated"),
                  onError: (err) => toast.error(err.message),
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
                  onError: (err) => toast.error(err.message),
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
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Base URL</dt>
            <dd className="mt-0.5 font-mono text-xs break-all">{source.baseUrl ?? "--"}</dd>
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

      {healthData && (
        <div className="mt-4">
          <HealthChart metrics={healthData.items} />
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-lg font-medium">Fetch History</h3>
        <div className="mt-3">
          <FetchHistoryTable
            fetches={fetches?.items ?? []}
            isLoading={fetchesLoading}
            expandedFetch={expandedFetch}
            onToggleFetch={(id) => setExpandedFetch(expandedFetch === id ? null : id)}
            pagination={
              fetches
                ? {
                    total: fetches.total,
                    limit: fetches.limit,
                    offset: fetches.offset,
                    onOffsetChange: setFetchOffset,
                  }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

function FetchHistoryTable({
  fetches,
  isLoading,
  expandedFetch,
  onToggleFetch,
  pagination,
}: {
  fetches: SourceFetch[];
  isLoading: boolean;
  expandedFetch: string | null;
  onToggleFetch: (id: string) => void;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    onOffsetChange: (offset: number) => void;
  };
}) {
  const reparse = useReparse();

  const columns: Column<SourceFetch>[] = [
    {
      key: "fetchStatus",
      header: "Status",
      cell: (row) => <StatusBadge status={row.fetchStatus} />,
    },
    {
      key: "httpStatus",
      header: "HTTP",
      cell: (row) => <span className="font-mono text-sm">{row.httpStatus ?? "--"}</span>,
    },
    {
      key: "contentHash",
      header: "Content Hash",
      cell: (row) =>
        row.contentHash ? (
          <span className="font-mono text-xs">{row.contentHash.slice(0, 12)}...</span>
        ) : (
          "--"
        ),
    },
    {
      key: "fetchedAt",
      header: "Fetched",
      cell: (row) => <TimeAgo date={row.fetchedAt} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFetch(row.id);
            }}
          >
            Parser Runs
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              reparse.mutate(row.id, {
                onSuccess: () => toast.success("Reparse queued"),
                onError: (err) => toast.error(err.message),
              });
            }}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Reparse
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        data={fetches}
        isLoading={isLoading}
        emptyMessage="No fetch history."
        pagination={pagination}
      />
      {expandedFetch && <ParserRunsPanel fetchId={expandedFetch} />}
    </div>
  );
}

function ParserRunsPanel({ fetchId }: { fetchId: string }) {
  const { data, isLoading } = useParserRuns(fetchId);

  const columns: Column<ParserRun>[] = [
    {
      key: "runStatus",
      header: "Status",
      cell: (row) => <StatusBadge status={row.runStatus} />,
    },
    {
      key: "parserKey",
      header: "Parser",
      cell: (row) => <span className="font-mono text-xs">{row.parserKey}</span>,
    },
    {
      key: "observationCount",
      header: "Observations",
      cell: (row) => row.observationCount,
    },
    {
      key: "confidence",
      header: "Confidence",
      cell: (row) => (row.confidence != null ? `${row.confidence}%` : "--"),
    },
    {
      key: "errorMessage",
      header: "Error",
      cell: (row) =>
        row.errorMessage ? (
          <span className="text-red-600 dark:text-red-400 text-xs truncate max-w-48 block">
            {row.errorMessage}
          </span>
        ) : (
          "--"
        ),
    },
    {
      key: "startedAt",
      header: "Started",
      cell: (row) => <TimeAgo date={row.startedAt} />,
    },
  ];

  return (
    <div className="ml-4 rounded-lg border bg-muted/30 p-4">
      <h4 className="mb-2 text-sm font-medium">Parser Runs for fetch {fetchId.slice(0, 15)}...</h4>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        emptyMessage="No parser runs."
      />
    </div>
  );
}
