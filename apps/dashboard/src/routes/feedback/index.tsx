import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useFeedback, useUpdateFeedback } from "@/api/hooks/use-feedback";
import type { FeedbackListItem } from "@/api/types";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { AppEntityLink } from "@/components/shared/entity-link";
import { IdDisplay } from "@/components/shared/id-display";
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

const feedbackSearchSchema = z.object({
  ...paginatedSearchShape,
  status: z.string().catch("new"),
  type: z.string().catch("all"),
});

export const Route = createFileRoute("/feedback/")({
  validateSearch: (search) => feedbackSearchSchema.parse(search),
  component: FeedbackPage,
});

function FeedbackPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const [selectedItem, setSelectedItem] = useState<FeedbackListItem | null>(null);
  const updateFeedback = useUpdateFeedback();

  const { data, isLoading } = useFeedback({
    status: searchState.status !== "all" ? searchState.status : undefined,
    feedbackType: searchState.type !== "all" ? searchState.type : undefined,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const handleStatusChange = useCallback(
    (id: string, status: "new" | "triaged" | "resolved" | "dismissed") => {
      updateFeedback.mutate(
        { id, status },
        {
          onSuccess: () => toast.success(`Feedback ${status}`),
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [updateFeedback],
  );

  const columns = useMemo<ColumnDef<FeedbackListItem>[]>(
    () => [
      {
        accessorKey: "feedbackType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.feedbackType}
          </span>
        ),
      },
      {
        id: "app",
        meta: { label: "App" },
        enableSorting: false,
        cell: ({ row }) =>
          row.original.targetApp ? (
            <AppEntityLink app={row.original.targetApp} showId />
          ) : (
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.appName ?? "Unknown app"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {row.original.bundleId ?? "--"}
              </div>
            </div>
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
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setSelectedItem(row.original)}>
              View
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleStatusChange(row.original.id, "triaged")}>
                  Triage
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange(row.original.id, "resolved")}>
                  Resolve
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange(row.original.id, "dismissed")}>
                  Dismiss
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [handleStatusChange],
  );

  const bulkActions: BulkAction<FeedbackListItem>[] = [
    {
      label: "Triage Selected",
      onClick: async (rows) => {
        for (const row of rows) {
          handleStatusChange(row.id, "triaged");
        }
      },
    },
    {
      label: "Resolve Selected",
      onClick: async (rows) => {
        for (const row of rows) {
          handleStatusChange(row.id, "resolved");
        }
      },
    },
    {
      label: "Dismiss Selected",
      variant: "destructive",
      onClick: async (rows) => {
        for (const row of rows) {
          handleStatusChange(row.id, "dismissed");
        }
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Feedback</h2>
      <p className="mt-1 text-muted-foreground">
        Client-reported feedback for triage and resolution.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={searchState.status}
          onValueChange={(value) =>
            void navigate({
              to: "/feedback",
              search: {
                ...searchState,
                page: 1,
                status: value,
              },
            })
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="triaged">Triaged</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={searchState.type}
          onValueChange={(value) =>
            void navigate({
              to: "/feedback",
              search: {
                ...searchState,
                page: 1,
                type: value,
              },
            })
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="wrong_match">Wrong Match</SelectItem>
            <SelectItem value="wrong_version">Wrong Version</SelectItem>
            <SelectItem value="app_request">App Request</SelectItem>
            <SelectItem value="general">General</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No feedback items."
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/feedback",
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
                      to: "/feedback",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
                }
              : undefined
          }
        />
      </div>

      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Feedback Detail</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <StatusBadge status={selectedItem.status} />
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                  {selectedItem.feedbackType}
                </span>
                <IdDisplay id={selectedItem.id} />
              </div>
              <dl className="space-y-1 text-sm">
                {selectedItem.appName && (
                  <div className="flex gap-2">
                    <dt className="w-24 text-muted-foreground">App Name</dt>
                    <dd>{selectedItem.appName}</dd>
                  </div>
                )}
                {selectedItem.bundleId && (
                  <div className="flex gap-2">
                    <dt className="w-24 text-muted-foreground">Bundle ID</dt>
                    <dd className="font-mono">{selectedItem.bundleId}</dd>
                  </div>
                )}
                {selectedItem.snapshotId && (
                  <div className="flex gap-2">
                    <dt className="w-24 text-muted-foreground">Snapshot</dt>
                    <dd>
                      <IdDisplay id={selectedItem.snapshotId} />
                    </dd>
                  </div>
                )}
              </dl>
              {selectedItem.payloadJson && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Payload</p>
                  <JsonViewer data={selectedItem.payloadJson} />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
