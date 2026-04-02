import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { extractSourceIdentifier, resolveSourceUrl } from "@versioneer/core/sources";
import type { SourceType } from "@versioneer/schemas/sources";
import { ArrowLeft, Ban, Inbox, RefreshCw, RotateCcw, Save, Zap } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useParserRuns,
  useReparse,
  useSource,
  useSourceFetches,
  useTriggerSourceFetch,
  useUpdateSource,
} from "@/api/hooks/use-sources";
import type { ParserRun, SourceFetch } from "@/api/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { AppEntityLink } from "@/components/shared/entity-link";
import { FormField } from "@/components/shared/form-field";
import { IdDisplay } from "@/components/shared/id-display";
import {
  parseConfigJson,
  serializeConfig,
  SourceConfigFields,
} from "@/components/shared/source-config-fields";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/format-duration";
import { SOURCE_TYPES } from "@/lib/source-types";

export const Route = createFileRoute("/sources/$sourceId")({
  component: SourceDetailPage,
});

function SourceDetailPage() {
  const { sourceId } = Route.useParams();
  const { data: source, isLoading } = useSource(sourceId);
  const triggerFetch = useTriggerSourceFetch();
  const updateSource = useUpdateSource(sourceId);
  const [expandedFetch, setExpandedFetch] = useState<string | null>(null);
  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);
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
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyDescription>Source not found.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
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
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {source.channel ?? "auto-detect"}
            </span>
          </div>
          {source.app ? (
            <div className="mt-3">
              <AppEntityLink app={source.app} showId />
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={source.channel ?? "auto"}
            onValueChange={(value) =>
              updateSource.mutate(
                { channel: value === "auto" ? null : value },
                {
                  onSuccess: () => toast.success("Channel updated"),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect</SelectItem>
              <SelectItem value="stable">Stable</SelectItem>
              <SelectItem value="beta">Beta</SelectItem>
              <SelectItem value="nightly">Nightly</SelectItem>
            </SelectContent>
          </Select>
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
            size="sm"
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
            <Zap />
            Trigger Fetch
          </Button>
          {source.status !== "disabled" ? (
            <Button variant="destructive" size="sm" onClick={() => setDisableConfirmOpen(true)}>
              <Ban className="h-4 w-4" />
              Disable
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateSource.mutate(
                  { status: "active" },
                  {
                    onSuccess: () => toast.success("Source re-enabled"),
                    onError: (error) => toast.error(error.message),
                  },
                )
              }
            >
              <RotateCcw className="h-4 w-4" />
              Re-enable
            </Button>
          )}
        </div>
      </div>

      {source.status === "disabled" ? (
        <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          This source is disabled and will not be polled for updates.
        </div>
      ) : null}

      <SourceEditForm
        sourceId={sourceId}
        sourceType={source.sourceType as SourceType}
        source={source}
      />

      <ConfirmDialog
        open={disableConfirmOpen}
        onOpenChange={setDisableConfirmOpen}
        title="Disable Source"
        description="This source will stop being polled for updates. Existing fetch history and parser runs will be preserved. You can re-enable it later."
        confirmLabel="Disable"
        variant="destructive"
        loading={updateSource.isPending}
        onConfirm={() =>
          updateSource.mutate(
            { status: "disabled" },
            {
              onSuccess: () => {
                toast.success("Source disabled");
                setDisableConfirmOpen(false);
              },
              onError: (error) => toast.error(error.message),
            },
          )
        }
      />

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

function SourceEditForm({
  sourceId,
  sourceType,
  source,
}: {
  sourceId: string;
  sourceType: SourceType;
  source: {
    label: string | null;
    baseUrl: string | null;
    parserKey: string;
    pollIntervalMinutes: number;
    configJson: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  };
}) {
  const updateSource = useUpdateSource(sourceId);
  const typeConfig = SOURCE_TYPES[sourceType];

  const form = useForm({
    defaultValues: {
      label: source.label ?? "",
      identifier: extractSourceIdentifier(sourceType, source.baseUrl),
      parserKey: source.parserKey,
      pollIntervalMinutes: source.pollIntervalMinutes,
      config: parseConfigJson(source.configJson),
    },
    onSubmit: async ({ value }) => {
      const baseUrl = resolveSourceUrl(sourceType, value.identifier);
      updateSource.mutate(
        {
          label: value.label || null,
          baseUrl: baseUrl || null,
          parserKey: value.parserKey,
          pollIntervalMinutes: value.pollIntervalMinutes,
          configJson: serializeConfig(value.config) ?? null,
        },
        {
          onSuccess: () => toast.success("Source updated"),
          onError: (err) => toast.error(err.message),
        },
      );
    },
  });

  return (
    <div className="mt-4 rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Configuration</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            Last success: <TimeAgo date={source.lastSuccessAt} />
          </span>
          <span>
            Last failure: <TimeAgo date={source.lastFailureAt} />
          </span>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="grid gap-4 sm:grid-cols-2"
      >
        <form.Field name="label">
          {(field) => (
            <FormField label="Label" name={field.name} meta={field.state.meta}>
              <Input
                id={field.name}
                placeholder="Optional label"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        {sourceType !== "manual" ? (
          <form.Field name="identifier">
            {(field) => (
              <FormField
                label={typeConfig.input.label || "URL"}
                name={field.name}
                meta={field.state.meta}
              >
                <Input
                  id={field.name}
                  placeholder={typeConfig.input.placeholder}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          </form.Field>
        ) : null}
        <form.Field
          name="parserKey"
          validators={{
            onBlur: ({ value }) => (!value ? "Parser key is required" : undefined),
          }}
        >
          {(field) => (
            <FormField label="Parser Key" name={field.name} meta={field.state.meta}>
              <Input
                id={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field name="pollIntervalMinutes">
          {(field) => (
            <FormField
              label="Poll Interval (minutes)"
              name={field.name}
              meta={field.state.meta}
              description="Min 5, max 10080."
            >
              <Input
                id={field.name}
                type="number"
                min={5}
                max={10080}
                value={field.state.value}
                onChange={(e) => field.handleChange(Number(e.target.value))}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <div className="sm:col-span-2">
          <form.Field name="config">
            {(field) => (
              <SourceConfigFields
                sourceType={sourceType}
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
              />
            )}
          </form.Field>
        </div>
        <div className="flex justify-end sm:col-span-2">
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting, state.isDirty]}
          >
            {([canSubmit, isSubmitting, isDirty]) => (
              <Button
                type="submit"
                size="sm"
                disabled={!canSubmit || isSubmitting || !isDirty || updateSource.isPending}
              >
                <Save className="h-4 w-4" />
                {updateSource.isPending ? "Saving..." : "Save Changes"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
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
  const reparse = useReparse(sourceId);

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
              <RefreshCw />
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
        header: "Duration",
        enableSorting: false,
        cell: ({ row }) => formatDuration(row.original.startedAt, row.original.finishedAt),
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
