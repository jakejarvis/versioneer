import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Zap } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useSources, useTriggerSourceFetch } from "@/api/hooks/use-sources";
import type { SourceListItem } from "@/api/types";
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
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const sourcesSearchSchema = z.object({
  ...paginatedSearchShape,
  status: z.enum(["all", "active", "paused", "disabled", "error"]).catch("all"),
  type: z.enum(["all", "sparkle", "github_releases", "manual", "homebrew_cask"]).catch("all"),
});

export const Route = createFileRoute("/sources/")({
  validateSearch: (search) => sourcesSearchSchema.parse(search),
  component: SourcesPage,
});

function SourcesPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const triggerFetch = useTriggerSourceFetch();

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
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Sources</h2>
      <p className="mt-1 text-muted-foreground">
        Manage update data sources and their fetch pipelines.
      </p>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No sources found."
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
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
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
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="sparkle">Sparkle</SelectItem>
                  <SelectItem value="github_releases">GitHub Releases</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="homebrew_cask">Homebrew Cask</SelectItem>
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
    </div>
  );
}
