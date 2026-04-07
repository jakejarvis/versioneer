import { createFileRoute, Link, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { CreateReleaseDialog } from "@/components/shared/create-release-dialog";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { AppEntityLink, ReleaseEntityLink } from "@/components/shared/entity-link";
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
import { useReleases } from "@/hooks/use-releases";
import { usePinRelease, useUnpinRelease } from "@/hooks/use-releases";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchDefaults,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";
import type { ReleaseListItem } from "@/lib/types";

const releasesSearchDefaults = {
  ...paginatedSearchDefaults,
  channel: "all" as const,
  status: "all" as const,
};

const releasesSearchSchema = z.object({
  ...paginatedSearchShape,
  channel: z
    .enum(["all", "stable", "beta", "nightly"])
    .default(releasesSearchDefaults.channel)
    .catch(releasesSearchDefaults.channel),
  status: z
    .enum(["all", "active", "superseded", "draft", "withdrawn"])
    .default(releasesSearchDefaults.status)
    .catch(releasesSearchDefaults.status),
});

export const Route = createFileRoute("/releases/")({
  validateSearch: releasesSearchSchema,
  search: { middlewares: [stripSearchParams(releasesSearchDefaults)] },
  component: ReleasesPage,
});

function ReleasesPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const pinRelease = usePinRelease();
  const unpinRelease = useUnpinRelease();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useReleases({
    channel: searchState.channel !== "all" ? searchState.channel : undefined,
    status: searchState.status !== "all" ? searchState.status : undefined,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const togglePin = useCallback(
    (row: ReleaseListItem) => {
      const mutation = row.isPinnedLatest ? unpinRelease : pinRelease;
      mutation.mutate(row.id, {
        onSuccess: () => toast.success(row.isPinnedLatest ? "Release unpinned" : "Release pinned"),
        onError: (err) => toast.error(err.message),
      });
    },
    [pinRelease, unpinRelease],
  );

  const columns = useMemo<ColumnDef<ReleaseListItem>[]>(
    () => [
      {
        id: "app",
        meta: { label: "App" },
        header: "App",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.app ? <AppEntityLink app={row.original.app} showId /> : <span>--</span>,
      },
      {
        accessorKey: "versionRaw",
        meta: { label: "Version" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Version" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <ReleaseEntityLink
              release={{
                id: row.original.id,
                versionRaw: row.original.versionRaw,
                channel: row.original.channel,
                status: row.original.status,
                isPrerelease: row.original.isPrerelease,
                releasedAt: row.original.releasedAt,
                app: row.original.app,
              }}
              showId
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {row.original.isLatestForChannel ? (
                <span className="rounded bg-muted px-2 py-0.5">Latest</span>
              ) : null}
              {row.original.isPinnedLatest ? (
                <span className="rounded bg-muted px-2 py-0.5">Pinned</span>
              ) : null}
              {row.original.isPrerelease ? (
                <span className="rounded bg-muted px-2 py-0.5">Prerelease</span>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "channel",
        meta: { label: "Channel" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Channel" />,
        cell: ({ row }) => <StatusBadge status={row.original.channel} />,
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "releasedAt",
        meta: { label: "Released" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Released" />,
        cell: ({ row }) => <TimeAgo date={row.original.releasedAt} />,
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Created" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <TimeAgo date={row.original.createdAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/releases/$releaseId" params={{ releaseId: row.original.id }}>
                Open
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => togglePin(row.original)}>
              {row.original.isPinnedLatest ? "Unpin" : "Pin"}
            </Button>
          </div>
        ),
      },
    ],
    [togglePin],
  );

  const bulkActions: BulkAction<ReleaseListItem>[] = [
    {
      label: "Pin Selected",
      disabled: pinRelease.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          pinRelease.mutate(row.id, { onError: (err) => toast.error(err.message) });
        }
        toast.success(`Pinned ${rows.length} release${rows.length === 1 ? "" : "s"}`);
      },
    },
    {
      label: "Unpin Selected",
      disabled: unpinRelease.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          unpinRelease.mutate(row.id, { onError: (err) => toast.error(err.message) });
        }
        toast.success(`Unpinned ${rows.length} release${rows.length === 1 ? "" : "s"}`);
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Releases</h2>
          <p className="mt-1 text-muted-foreground">Browse release records across all apps.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Create Release
        </Button>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No releases."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({ to: "/releases", search: applySortingToSearch(searchState, updater) })
          }
          manualSorting
          enableColumnVisibility
          enableRowSelection
          bulkActions={bulkActions}
          toolbar={
            <>
              <Select
                value={searchState.channel}
                onValueChange={(value) =>
                  void navigate({
                    to: "/releases",
                    search: {
                      ...searchState,
                      page: 1,
                      channel: value as typeof searchState.channel,
                    },
                  })
                }
              >
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="stable">Stable</SelectItem>
                  <SelectItem value="beta">Beta</SelectItem>
                  <SelectItem value="nightly">Nightly</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={searchState.status}
                onValueChange={(value) =>
                  void navigate({
                    to: "/releases",
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
                  <SelectItem value="superseded">Superseded</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="withdrawn">Withdrawn</SelectItem>
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
                      to: "/releases",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>

      <CreateReleaseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
