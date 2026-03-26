import { createFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useFeedback, useUpdateFeedback } from "@/api/hooks/use-feedback";
import type { FeedbackItem } from "@/api/types";
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

export const Route = createFileRoute("/feedback/")({
  component: FeedbackPage,
});

function FeedbackPage() {
  const [statusFilter, setStatusFilter] = useState<string>("new");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [selectedItem, setSelectedItem] = useState<FeedbackItem | null>(null);
  const updateFeedback = useUpdateFeedback();

  const { data, isLoading } = useFeedback({
    status: statusFilter !== "all" ? statusFilter : undefined,
    feedbackType: typeFilter !== "all" ? typeFilter : undefined,
    limit: 50,
    offset,
  });

  const handleStatusChange = (id: string, status: "new" | "triaged" | "resolved" | "dismissed") => {
    updateFeedback.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(`Feedback ${status}`),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const columns: Column<FeedbackItem>[] = [
    {
      key: "feedbackType",
      header: "Type",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{row.feedbackType}</span>
      ),
    },
    {
      key: "appName",
      header: "App",
      cell: (row) => row.appName ?? row.bundleId ?? "--",
    },
    {
      key: "targetAppId",
      header: "Target",
      cell: (row) =>
        row.targetAppId ? (
          <Link
            to="/apps/$appId"
            params={{ appId: row.targetAppId }}
            className="text-blue-600 hover:underline"
          >
            <IdDisplay id={row.targetAppId} />
          </Link>
        ) : (
          "--"
        ),
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
          <Button variant="ghost" size="sm" onClick={() => setSelectedItem(row)}>
            View
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleStatusChange(row.id, "triaged")}>
                Triage
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleStatusChange(row.id, "resolved")}>
                Resolve
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleStatusChange(row.id, "dismissed")}>
                Dismiss
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Feedback</h2>
      <p className="mt-1 text-muted-foreground">
        Client-reported feedback for triage and resolution.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setOffset(0);
          }}
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
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v);
            setOffset(0);
          }}
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
