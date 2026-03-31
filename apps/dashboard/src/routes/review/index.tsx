import { createFileRoute, Link, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useApproveCatalogSuggestion,
  useCatalogSuggestion,
  useCatalogSuggestions,
  useRejectCatalogSuggestion,
} from "@/api/hooks/use-review";
import type { CatalogSuggestion } from "@/api/types";
import { AppIcon } from "@/components/shared/app-icon";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { JsonViewer } from "@/components/shared/json-viewer";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchDefaults,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const reviewSearchDefaults = {
  ...paginatedSearchDefaults,
  status: "pending" as const,
  queueType: "all",
};

const reviewSearchSchema = z.object({
  ...paginatedSearchShape,
  status: z
    .enum(["pending", "approved", "rejected", "superseded"])
    .default(reviewSearchDefaults.status)
    .catch(reviewSearchDefaults.status),
  queueType: z
    .string()
    .default(reviewSearchDefaults.queueType)
    .catch(reviewSearchDefaults.queueType),
});

export const Route = createFileRoute("/review/")({
  validateSearch: reviewSearchSchema,
  search: { middlewares: [stripSearchParams(reviewSearchDefaults)] },
  component: ReviewPage,
});

function ReviewPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const approveMutation = useApproveCatalogSuggestion();
  const rejectMutation = useRejectCatalogSuggestion();

  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const selectedSuggestion = useCatalogSuggestion(selectedSuggestionId ?? "");

  const { data, isLoading } = useCatalogSuggestions({
    status: searchState.status,
    queueType:
      searchState.queueType !== "all"
        ? (searchState.queueType as CatalogSuggestion["queueType"])
        : undefined,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const closeDialog = () => setSelectedSuggestionId(null);

  const columns = useMemo<ColumnDef<CatalogSuggestion>[]>(
    () => [
      {
        accessorKey: "queueType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        enableSorting: false,
        cell: ({ row }) => <StatusBadge status={row.original.queueType} className="capitalize" />,
      },
      {
        accessorKey: "title",
        meta: { label: "Title" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setSelectedSuggestionId(row.original.id)}
            className="max-w-72 truncate text-left font-medium hover:text-foreground hover:underline"
          >
            {row.original.title}
          </button>
        ),
      },
      {
        id: "app",
        meta: { label: "App" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="App" />,
        cell: ({ row }) => {
          const app = row.original.app ?? row.original.source?.app;
          if (!app) return <span className="text-muted-foreground">--</span>;
          return (
            <Link
              to="/apps/$appId"
              params={{ appId: app.id }}
              className="flex min-w-0 items-center gap-2 hover:text-foreground"
            >
              <AppIcon iconR2Key={app.iconR2Key} appName={app.canonicalName} size={24} />
              <span className="truncate text-sm">{app.canonicalName}</span>
            </Link>
          );
        },
      },
      {
        accessorKey: "evidenceCount",
        meta: { label: "Evidence" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Evidence" />,
        cell: ({ row }) => <Badge variant="outline">{row.original.evidenceCount}</Badge>,
      },
      {
        accessorKey: "firstSeenAt",
        meta: { label: "First Seen" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="First Seen" />,
        cell: ({ row }) => <TimeAgo date={row.original.firstSeenAt} />,
      },
      {
        accessorKey: "lastSeenAt",
        meta: { label: "Last Seen" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last Seen" />,
        cell: ({ row }) => <TimeAgo date={row.original.lastSeenAt} />,
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.status === "pending" ? (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={approveMutation.isPending || rejectMutation.isPending}
                onClick={() => {
                  approveMutation.mutate(row.original.id, {
                    onSuccess: () => toast.success("Approved"),
                    onError: (error) => toast.error(error.message),
                  });
                }}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={approveMutation.isPending || rejectMutation.isPending}
                onClick={() => {
                  rejectMutation.mutate(row.original.id, {
                    onSuccess: () => toast.success("Rejected"),
                    onError: (error) => toast.error(error.message),
                  });
                }}
              >
                Reject
              </Button>
            </div>
          ) : null,
      },
    ],
    [approveMutation, rejectMutation],
  );

  const bulkActions: BulkAction<CatalogSuggestion>[] = [
    {
      label: "Approve Selected",
      disabled: approveMutation.isPending || rejectMutation.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          approveMutation.mutate(row.id, { onError: (err) => toast.error(err.message) });
        }
        toast.success(`Approved ${rows.length} suggestion${rows.length === 1 ? "" : "s"}`);
      },
    },
    {
      label: "Reject Selected",
      variant: "destructive",
      disabled: approveMutation.isPending || rejectMutation.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          rejectMutation.mutate(row.id, { onError: (err) => toast.error(err.message) });
        }
        toast.success(`Rejected ${rows.length} suggestion${rows.length === 1 ? "" : "s"}`);
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Catalog Review</h2>
      <p className="mt-1 text-muted-foreground">
        Review and action catalog suggestions. FIFO queue backed by deduped evidence.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={searchState.status}
          onValueChange={(value) =>
            void navigate({
              to: "/review",
              search: { ...searchState, page: 1, status: value as typeof searchState.status },
            })
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={searchState.queueType}
          onValueChange={(value) =>
            void navigate({
              to: "/review",
              search: { ...searchState, page: 1, queueType: value },
            })
          }
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="new_app">New App</SelectItem>
            <SelectItem value="new_source">New Source</SelectItem>
            <SelectItem value="metadata_change">Metadata Change</SelectItem>
            <SelectItem value="authority_handoff">Authority Handoff</SelectItem>
            <SelectItem value="merge_proposal">Merge Proposal</SelectItem>
            <SelectItem value="release_discrepancy">Release Discrepancy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No catalog suggestions."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/review",
              search: applySortingToSearch(searchState, updater),
            })
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
                    void navigate({
                      to: "/review",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>

      <Dialog open={!!selectedSuggestionId} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedSuggestion.data?.title ?? "Review suggestion"}</DialogTitle>
            <DialogDescription>
              Review the canonical snapshot, proposed change, and underlying evidence before
              applying it.
            </DialogDescription>
          </DialogHeader>

          {!selectedSuggestionId || selectedSuggestion.isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : selectedSuggestion.data ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selectedSuggestion.data.queueType} className="capitalize" />
                <StatusBadge status={selectedSuggestion.data.status} />
                <Badge variant="outline">{selectedSuggestion.data.evidenceCount} evidence</Badge>
                {selectedSuggestion.data.app ? (
                  <Link
                    to="/apps/$appId"
                    params={{ appId: selectedSuggestion.data.app.id }}
                    className="hover:underline"
                  >
                    <Badge variant="outline">
                      app: {selectedSuggestion.data.app.canonicalName}
                    </Badge>
                  </Link>
                ) : null}
                {selectedSuggestion.data.source ? (
                  <Link
                    to="/sources/$sourceId"
                    params={{ sourceId: selectedSuggestion.data.source.id }}
                    className="hover:underline"
                  >
                    <Badge variant="outline">
                      source:{" "}
                      {selectedSuggestion.data.source.label ??
                        selectedSuggestion.data.source.sourceType}
                    </Badge>
                  </Link>
                ) : null}
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Current</h4>
                  <JsonViewer
                    data={selectedSuggestion.data.canonicalSnapshotJson}
                    className="min-h-40"
                  />
                </section>
                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Proposed</h4>
                  <JsonViewer
                    data={selectedSuggestion.data.proposedChangeJson}
                    className="min-h-40"
                  />
                </section>
                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Evidence Summary</h4>
                  <JsonViewer
                    data={selectedSuggestion.data.evidenceSummaryJson}
                    className="min-h-40"
                  />
                </section>
              </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Evidence</h4>
                  <span className="text-xs text-muted-foreground">
                    first seen <TimeAgo date={selectedSuggestion.data.firstSeenAt} />
                  </span>
                </div>
                <div className="space-y-3">
                  {selectedSuggestion.data.evidence.map((entry) => (
                    <div key={entry.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusBadge status={entry.evidenceType} />
                        <span>{entry.fingerprint}</span>
                        <span>
                          observed <TimeAgo date={entry.observedAt} />
                        </span>
                      </div>
                      <JsonViewer data={entry.payloadJson} className="mt-3 max-h-56" />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">Suggestion not found.</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={
                !selectedSuggestionId ||
                selectedSuggestion.data?.status !== "pending" ||
                rejectMutation.isPending ||
                approveMutation.isPending
              }
              onClick={() => {
                if (!selectedSuggestionId) return;
                rejectMutation.mutate(selectedSuggestionId, {
                  onSuccess: () => {
                    toast.success("Suggestion rejected");
                    closeDialog();
                  },
                  onError: (error) => toast.error(error.message),
                });
              }}
            >
              Reject
            </Button>
            <Button
              disabled={
                !selectedSuggestionId ||
                selectedSuggestion.data?.status !== "pending" ||
                rejectMutation.isPending ||
                approveMutation.isPending
              }
              onClick={() => {
                if (!selectedSuggestionId) return;
                approveMutation.mutate(selectedSuggestionId, {
                  onSuccess: () => {
                    toast.success("Suggestion approved");
                    closeDialog();
                  },
                  onError: (error) => toast.error(error.message),
                });
              }}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
