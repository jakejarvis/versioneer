import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { CheckCircle, MoreHorizontal, Workflow, XCircle } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useApprovePublication,
  useResolveMatch,
  useReviewQueue,
  useUpdateReviewItem,
} from "@/api/hooks/use-review-queue";
import type { ReviewQueueListItem } from "@/api/types";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { JsonViewer } from "@/components/shared/json-viewer";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const reviewQueueSearchSchema = z.object({
  ...paginatedSearchShape,
  status: z.enum(["pending", "in_progress", "resolved", "dismissed"]).catch("pending"),
});

export const Route = createFileRoute("/review-queue/")({
  validateSearch: (search) => reviewQueueSearchSchema.parse(search),
  component: ReviewQueuePage,
});

const aliasTypes = [
  "bundle_id",
  "name",
  "team_id",
  "sparkle_feed",
  "homepage",
  "download_pattern",
  "github_repo",
  "mas_app_id",
] as const;

type AliasType = (typeof aliasTypes)[number];

interface ResolveMatchDraft {
  appId: string;
  aliasType: AliasType;
  value: string;
  summary: string;
}

function parsePayload(payloadJson: string | null): Record<string, unknown> | null {
  if (!payloadJson) {
    return null;
  }

  try {
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getResolveMatchDraft(item: ReviewQueueListItem): ResolveMatchDraft | null {
  const payload = parsePayload(item.payloadJson);

  if (!payload) {
    return null;
  }

  const appId =
    typeof payload.appId === "string"
      ? payload.appId
      : typeof payload.targetAppId === "string"
        ? payload.targetAppId
        : null;
  const aliasType =
    typeof payload.aliasType === "string" && aliasTypes.includes(payload.aliasType as AliasType)
      ? (payload.aliasType as AliasType)
      : null;
  const value = typeof payload.value === "string" ? payload.value : null;

  if (appId && aliasType && value) {
    return {
      appId,
      aliasType,
      value,
      summary: `${aliasType}: ${value}`,
    };
  }

  if (!appId) {
    return null;
  }

  if (typeof payload.bundleId === "string" && payload.bundleId.length > 0) {
    return {
      appId,
      aliasType: "bundle_id",
      value: payload.bundleId,
      summary: `bundle_id: ${payload.bundleId}`,
    };
  }

  if (typeof payload.appName === "string" && payload.appName.length > 0) {
    return {
      appId,
      aliasType: "name",
      value: payload.appName,
      summary: `name: ${payload.appName}`,
    };
  }

  return null;
}

function ReviewQueuePage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueListItem | null>(null);
  const updateItem = useUpdateReviewItem();
  const approvePublication = useApprovePublication();
  const resolveMatch = useResolveMatch();

  const { data, isLoading } = useReviewQueue({
    status: searchState.status,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const handleAction = useCallback(
    (id: string, status: "resolved" | "dismissed" | "in_progress") => {
      updateItem.mutate(
        { id, status },
        {
          onSuccess: () => toast.success(`Item ${status}`),
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [updateItem],
  );

  const handleApprovePublication = useCallback(
    (id: string) => {
      approvePublication.mutate(id, {
        onSuccess: () => toast.success("Publication approved"),
        onError: (err) => toast.error(err.message),
      });
    },
    [approvePublication],
  );

  const handleResolveMatch = useCallback(
    (item: ReviewQueueListItem) => {
      const draft = getResolveMatchDraft(item);

      if (!draft) {
        toast.error("This review item does not include enough match data to resolve.");
        return;
      }

      resolveMatch.mutate(
        {
          id: item.id,
          appId: draft.appId,
          aliasType: draft.aliasType,
          value: draft.value,
        },
        {
          onSuccess: () => toast.success("Match resolved and alias created"),
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [resolveMatch],
  );

  const columns = useMemo<ColumnDef<ReviewQueueListItem>[]>(
    () => [
      {
        accessorKey: "reviewType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.reviewType}
          </span>
        ),
      },
      {
        id: "relatedRef",
        meta: { label: "Related" },
        enableSorting: false,
        cell: ({ row }) => <EntityReferenceLink refItem={row.original.relatedRef} />,
      },
      {
        accessorKey: "priority",
        meta: { label: "Priority" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Priority" />,
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{row.original.priority}</span>
        ),
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
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const resolveDraft = getResolveMatchDraft(row.original);
          const canApprove =
            row.original.reviewType === "publication_gated" && row.original.status === "pending";
          const canResolveMatch = Boolean(resolveDraft) && row.original.status === "pending";
          const canOpenMenu =
            row.original.status === "pending" || row.original.status === "in_progress";

          return (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setSelectedItem(row.original)}>
                View
              </Button>
              {canApprove ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleApprovePublication(row.original.id)}
                >
                  Approve
                </Button>
              ) : null}
              {canResolveMatch ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleResolveMatch(row.original)}
                >
                  Resolve Match
                </Button>
              ) : null}
              {canOpenMenu ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {row.original.status === "pending" ? (
                      <DropdownMenuItem
                        onClick={() => handleAction(row.original.id, "in_progress")}
                      >
                        <Workflow />
                        Mark In Progress
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={() => handleAction(row.original.id, "resolved")}>
                      <CheckCircle />
                      Resolve
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleAction(row.original.id, "dismissed")}>
                      <XCircle />
                      Dismiss
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          );
        },
      },
    ],
    [handleAction, handleApprovePublication, handleResolveMatch],
  );

  const bulkActions: BulkAction<ReviewQueueListItem>[] = [
    {
      label: "Mark In Progress",
      onClick: async (rows) => {
        for (const row of rows) {
          if (row.status === "pending") {
            handleAction(row.id, "in_progress");
          }
        }
      },
    },
    {
      label: "Resolve Selected",
      onClick: async (rows) => {
        for (const row of rows) {
          if (row.status === "pending" || row.status === "in_progress") {
            handleAction(row.id, "resolved");
          }
        }
      },
    },
    {
      label: "Dismiss Selected",
      variant: "destructive",
      onClick: async (rows) => {
        for (const row of rows) {
          if (row.status === "pending" || row.status === "in_progress") {
            handleAction(row.id, "dismissed");
          }
        }
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Review Queue</h2>
      <p className="mt-1 text-muted-foreground">Items requiring manual review.</p>

      <div className="mt-4">
        <Select
          value={searchState.status}
          onValueChange={(value) =>
            void navigate({
              to: "/review-queue",
              search: {
                ...searchState,
                page: 1,
                status: value as typeof searchState.status,
              },
            })
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No review items."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/review-queue",
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
                      to: "/review-queue",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>

      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review Item</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Type: </span>
                {selectedItem.reviewType}
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Related: </span>
                <div className="mt-1">
                  <EntityReferenceLink refItem={selectedItem.relatedRef} />
                </div>
              </div>
              {selectedItem.status === "pending" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {selectedItem.reviewType === "publication_gated" ? (
                    <Button size="sm" onClick={() => handleApprovePublication(selectedItem.id)}>
                      Approve Publication
                    </Button>
                  ) : null}
                  {getResolveMatchDraft(selectedItem) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResolveMatch(selectedItem)}
                    >
                      Resolve Match
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAction(selectedItem.id, "in_progress")}
                  >
                    Mark In Progress
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAction(selectedItem.id, "resolved")}
                  >
                    Resolve
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleAction(selectedItem.id, "dismissed")}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : null}
              <div>
                <span className="text-sm text-muted-foreground">Payload:</span>
                <JsonViewer data={selectedItem.payloadJson} className="mt-1" />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
