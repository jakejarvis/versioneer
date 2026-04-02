import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { sourceTypeValues } from "@versioneer/schemas/sources";
import { Plus, Zap } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { CreateSourceDialog } from "@/components/shared/create-source-dialog";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { AppEntityLink, SourceEntityLink } from "@/components/shared/entity-link";
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
import { useBulkUpdateSourceStatus, useSources, useTriggerSourceFetch } from "@/hooks/use-sources";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchDefaults,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";
import { SOURCE_TYPES } from "@/lib/source-types";
import type { SourceListItem } from "@/lib/types";

const sourcesSearchDefaults = {
  ...paginatedSearchDefaults,
  status: "all" as const,
  type: "all" as const,
};

const sourcesSearchSchema = z.object({
  ...paginatedSearchShape,
  status: z
    .enum(["all", "active", "paused", "disabled", "error", "at_risk"])
    .default(sourcesSearchDefaults.status)
    .catch(sourcesSearchDefaults.status),
  type: z
    .enum(["all", ...sourceTypeValues])
    .default(sourcesSearchDefaults.type)
    .catch(sourcesSearchDefaults.type),
});

export const Route = createFileRoute("/sources/")({
  validateSearch: sourcesSearchSchema,
  search: { middlewares: [stripSearchParams(sourcesSearchDefaults)] },
  component: SourcesPage,
});

function SourcesPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const triggerFetch = useTriggerSourceFetch();
  const bulkStatusUpdate = useBulkUpdateSourceStatus();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useSources({
    status: searchState.status !== "all" ? searchState.status : undefined,
    sourceType: searchState.type !== "all" ? searchState.type : undefined,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const queueFetch = useCallback(
    (sourceId: string) =>
      triggerFetch.mutate(
        { sourceId },
        {
          onSuccess: () => toast.success("Fetch queued"),
          onError: (err) => toast.error(err.message),
        },
      ),
    [triggerFetch],
  );

  const columns = useMemo<ColumnDef<SourceListItem>[]>(
    () => [
      {
        accessorKey: "label",
        meta: { label: "Source" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => (
          <SourceEntityLink
            source={{
              id: row.original.id,
              label: row.original.label,
              sourceType: row.original.sourceType,
              parserKey: row.original.parserKey,
              channel: row.original.channel,
              reviewStatus: row.original.reviewStatus,
              role: row.original.role,
              status: row.original.status,
              app: row.original.app,
            }}
            showId
          />
        ),
      },
      {
        id: "app",
        meta: { label: "App" },
        header: "App",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.app ? <AppEntityLink app={row.original.app} showId /> : <span>--</span>,
      },
      {
        accessorKey: "sourceType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.sourceType}
          </span>
        ),
      },
      {
        accessorKey: "channel",
        meta: { label: "Channel" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Channel" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.channel ?? "auto"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "pollIntervalMinutes",
        meta: { label: "Interval" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Interval" />,
        cell: ({ row }) => `${row.original.pollIntervalMinutes}m`,
      },
      {
        accessorKey: "lastFetchedAt",
        meta: { label: "Last Fetch" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last Fetch" />,
        cell: ({ row }) => <TimeAgo date={row.original.lastFetchedAt} />,
      },
      {
        accessorKey: "lastSuccessAt",
        meta: { label: "Last Success" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last Success" />,
        cell: ({ row }) => <TimeAgo date={row.original.lastSuccessAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => queueFetch(row.original.id)}>
            <Zap />
            Fetch
          </Button>
        ),
      },
    ],
    [queueFetch],
  );

  const bulkActions: BulkAction<SourceListItem>[] = [
    {
      label: "Fetch Selected",
      disabled: triggerFetch.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          queueFetch(row.id);
        }
      },
    },
    {
      label: "Pause Selected",
      disabled: bulkStatusUpdate.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          bulkStatusUpdate.mutate(
            { id: row.id, status: "paused" },
            { onError: (err) => toast.error(err.message) },
          );
        }
        toast.success(`Paused ${rows.length} source${rows.length === 1 ? "" : "s"}`);
      },
    },
    {
      label: "Activate Selected",
      disabled: bulkStatusUpdate.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          bulkStatusUpdate.mutate(
            { id: row.id, status: "active" },
            { onError: (err) => toast.error(err.message) },
          );
        }
        toast.success(`Activated ${rows.length} source${rows.length === 1 ? "" : "s"}`);
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Sources</h2>
          <p className="mt-1 text-muted-foreground">
            Manage update data sources and their fetch pipelines.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Add Source
        </Button>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No sources."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({ to: "/sources", search: applySortingToSearch(searchState, updater) })
          }
          manualSorting
          enableColumnVisibility
          enableRowSelection
          bulkActions={bulkActions}
          toolbar={
            <>
              <Select
                value={searchState.status}
                onValueChange={(value) =>
                  void navigate({
                    to: "/sources",
                    search: {
                      ...searchState,
                      page: 1,
                      status: value as typeof searchState.status,
                    },
                  })
                }
              >
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="at_risk">At Risk</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={searchState.type}
                onValueChange={(value) =>
                  void navigate({
                    to: "/sources",
                    search: {
                      ...searchState,
                      page: 1,
                      type: value as typeof searchState.type,
                    },
                  })
                }
              >
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {Object.entries(SOURCE_TYPES).map(([value, cfg]) => (
                    <SelectItem key={value} value={value}>
                      {cfg.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
          pagination={
            data
              ? {
                  total: data.total,
                  pageIndex: pagination.pageIndex,
                  pageSize: pagination.pageSize,
                  pageCount,
                  onPaginationChange: (updater) =>
                    void navigate({
                      to: "/sources",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>

      <CreateSourceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
