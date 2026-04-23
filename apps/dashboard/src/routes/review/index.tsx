import { createFileRoute, Link, stripSearchParams } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

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
  useApproveCatalogSuggestion,
  useCatalogSuggestion,
  useCatalogSuggestions,
  useRejectCatalogSuggestion,
} from "@/hooks/use-review";
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchDefaults,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";
import {
  getCatalogSuggestionApprovalLabel,
  getCatalogSuggestionApprovalResultMessage,
  getCatalogSuggestionRejectResultMessage,
  isActionableCatalogSuggestionStatus,
} from "@/lib/review-lifecycle";
import type { CatalogSuggestion } from "@/lib/types";
import { suggestionStatusSchema } from "@versioneer/schemas/review";

const reviewSearchDefaults = {
  ...paginatedSearchDefaults,
  status: "pending" as const,
  queueType: "all",
};

const reviewSearchSchema = z.object({
  ...paginatedSearchShape,
  status: suggestionStatusSchema
    .default(reviewSearchDefaults.status)
    .catch(reviewSearchDefaults.status),
  queueType: z
    .string()
    .default(reviewSearchDefaults.queueType)
    .catch(reviewSearchDefaults.queueType),
});

function showApproveResultToast(status: CatalogSuggestion["status"]) {
  const message = getCatalogSuggestionApprovalResultMessage(status);
  if (status === "approved") {
    toast.success(message);
    return;
  }
  toast.info(message);
}

function showRejectResultToast(status: CatalogSuggestion["status"]) {
  const message = getCatalogSuggestionRejectResultMessage(status);
  if (status === "rejected") {
    toast.success(message);
    return;
  }
  toast.info(message);
}

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
  const selectedSuggestionActionable = selectedSuggestion.data
    ? isActionableCatalogSuggestionStatus(selectedSuggestion.data.status)
    : false;

  const handleApprove = (id: string) => {
    approveMutation.mutate(id, {
      onSuccess: (result) => {
        showApproveResultToast(result.status);
        if (result.status === "approved" && selectedSuggestionId === id) {
          closeDialog();
        }
      },
      onError: (error) => toast.error(error.message),
    });
  };

  const handleReject = (id: string) => {
    rejectMutation.mutate(id, {
      onSuccess: (result) => {
        showRejectResultToast(result.status);
        if (result.status === "rejected" && selectedSuggestionId === id) {
          closeDialog();
        }
      },
      onError: (error) => toast.error(error.message),
    });
  };

  const columns: ColumnDef<CatalogSuggestion>[] = [
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
        isActionableCatalogSuggestionStatus(row.original.status) ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={approveMutation.isPending || rejectMutation.isPending}
              onClick={() => handleApprove(row.original.id)}
            >
              {getCatalogSuggestionApprovalLabel(row.original.status)}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={approveMutation.isPending || rejectMutation.isPending}
              onClick={() => handleReject(row.original.id)}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  const bulkActions: BulkAction<CatalogSuggestion>[] = [
    {
      label: searchState.status === "failed" ? "Retry Approval Selected" : "Approve Selected",
      disabled: approveMutation.isPending || rejectMutation.isPending,
      onClick: async (rows) => {
        let approvedCount = 0;
        let inFlightCount = 0;
        for (const row of rows) {
          try {
            const result = await approveMutation.mutateAsync(row.id);
            if (result.status === "approved") {
              approvedCount += 1;
            } else if (result.status === "processing") {
              inFlightCount += 1;
            }
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          }
        }
        if (approvedCount > 0) {
          toast.success(`${approvedCount} suggestion${approvedCount === 1 ? "" : "s"} approved`);
        }
        if (inFlightCount > 0) {
          toast.info(
            `${inFlightCount} suggestion${inFlightCount === 1 ? "" : "s"} already processing`,
          );
        }
      },
    },
    {
      label: "Reject Selected",
      variant: "destructive",
      disabled: approveMutation.isPending || rejectMutation.isPending,
      onClick: async (rows) => {
        let rejectedCount = 0;
        let skippedCount = 0;
        for (const row of rows) {
          try {
            const result = await rejectMutation.mutateAsync(row.id);
            if (result.status === "rejected") {
              rejectedCount += 1;
            } else {
              skippedCount += 1;
            }
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          }
        }
        if (rejectedCount > 0) {
          toast.success(`${rejectedCount} suggestion${rejectedCount === 1 ? "" : "s"} rejected`);
        }
        if (skippedCount > 0) {
          toast.info(
            `${skippedCount} suggestion${skippedCount === 1 ? "" : "s"} could not be rejected`,
          );
        }
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Catalog Review</h2>
      <p className="mt-1 text-muted-foreground">
        Review and action catalog suggestions, including failed approvals that need a retry.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={searchState.status}
          onValueChange={(value) =>
            void navigate({
              to: "/review",
              search: { ...searchState, page: 1, status: value as typeof searchState.status },
            })
          }
        >
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
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
          <SelectTrigger className="w-full sm:w-48">
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
          enableRowSelection={(row) => isActionableCatalogSuggestionStatus(row.original.status)}
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
                <Badge variant="outline">
                  attempts: {selectedSuggestion.data.approvalAttemptCount}
                </Badge>
                {selectedSuggestion.data.processingStartedAt ? (
                  <Badge variant="outline">
                    processing since <TimeAgo date={selectedSuggestion.data.processingStartedAt} />
                  </Badge>
                ) : null}
                {selectedSuggestion.data.processingBy ? (
                  <Badge variant="outline">
                    processing by: {selectedSuggestion.data.processingBy}
                  </Badge>
                ) : null}
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

              {selectedSuggestion.data.lastError ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-3 text-sm">
                  <div className="font-medium text-red-700 dark:text-red-400">
                    Last approval error
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {selectedSuggestion.data.lastError}
                  </div>
                </div>
              ) : null}

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
                !selectedSuggestionActionable ||
                rejectMutation.isPending ||
                approveMutation.isPending
              }
              onClick={() => {
                if (!selectedSuggestionId) return;
                handleReject(selectedSuggestionId);
              }}
            >
              Reject
            </Button>
            <Button
              disabled={
                !selectedSuggestionId ||
                !selectedSuggestionActionable ||
                rejectMutation.isPending ||
                approveMutation.isPending
              }
              onClick={() => {
                if (!selectedSuggestionId) return;
                handleApprove(selectedSuggestionId);
              }}
            >
              {getCatalogSuggestionApprovalLabel(selectedSuggestion.data?.status ?? "pending")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
