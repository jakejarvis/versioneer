import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useReviewQueue, useUpdateReviewItem } from "@/api/hooks/use-review-queue";
import type { ReviewQueueItem } from "@/api/types";
import { DataTable, type Column } from "@/components/shared/data-table";
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

export const Route = createFileRoute("/review-queue/")({
  component: ReviewQueuePage,
});

function ReviewQueuePage() {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [offset, setOffset] = useState(0);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueItem | null>(null);
  const updateItem = useUpdateReviewItem();

  const { data, isLoading } = useReviewQueue({
    status: statusFilter,
    limit: 50,
    offset,
  });

  const handleAction = (id: string, status: string) => {
    updateItem.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(`Item ${status}`),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const columns: Column<ReviewQueueItem>[] = [
    {
      key: "reviewType",
      header: "Type",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{row.reviewType}</span>
      ),
    },
    {
      key: "relatedId",
      header: "Related",
      cell: (row) => (row.relatedId ? <IdDisplay id={row.relatedId} /> : "--"),
    },
    {
      key: "priority",
      header: "Priority",
      cell: (row) => row.priority,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "createdAt",
      header: "Created",
      cell: (row) => <TimeAgo date={row.createdAt} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedItem(row);
            }}
          >
            View
          </Button>
          {row.status === "pending" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleAction(row.id, "resolved")}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Resolve
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleAction(row.id, "dismissed")}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Dismiss
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Review Queue</h2>
      <p className="mt-1 text-muted-foreground">Items requiring manual review.</p>

      <div className="mt-4">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setOffset(0);
          }}
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
          pagination={
            data
              ? {
                  total: data.total,
                  limit: data.limit,
                  offset: data.offset,
                  onOffsetChange: setOffset,
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
                {selectedItem.relatedId ?? "--"}
              </div>
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
