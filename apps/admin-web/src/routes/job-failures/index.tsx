import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "../__root";
import {
  useJobFailures,
  useUpdateJobFailure,
  useRetryJobFailure,
} from "@/api/hooks/use-job-failures";
import type { JobFailure } from "@/api/types";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { IdDisplay } from "@/components/shared/id-display";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, RefreshCw, CheckCircle, Ban } from "lucide-react";
import { toast } from "sonner";

export const jobFailuresIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/job-failures",
  component: JobFailuresPage,
});

function JobFailuresPage() {
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [offset, setOffset] = useState(0);
  const [selectedFailure, setSelectedFailure] = useState<JobFailure | null>(null);
  const updateFailure = useUpdateJobFailure();
  const retryFailure = useRetryJobFailure();

  const { data, isLoading } = useJobFailures({
    status: statusFilter,
    limit: 50,
    offset,
  });

  const handleRetry = (id: string) => {
    retryFailure.mutate(id, {
      onSuccess: () => toast.success("Job re-enqueued"),
      onError: (err) => toast.error(err.message),
    });
  };

  const handleStatusChange = (id: string, status: string) => {
    updateFailure.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(`Marked as ${status}`),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const columns: Column<JobFailure>[] = [
    {
      key: "jobType",
      header: "Job Type",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
          {row.jobType}
        </span>
      ),
    },
    {
      key: "relatedId",
      header: "Related",
      cell: (row) => (row.relatedId ? <IdDisplay id={row.relatedId} /> : "--"),
    },
    {
      key: "errorMessage",
      header: "Error",
      cell: (row) =>
        row.errorMessage ? (
          <span
            className="text-xs text-red-600 truncate max-w-48 block cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedFailure(row);
            }}
          >
            {row.errorMessage}
          </span>
        ) : (
          "--"
        ),
    },
    {
      key: "retryCount",
      header: "Retries",
      cell: (row) => row.retryCount,
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
      cell: (row) =>
        row.status === "open" || row.status === "retrying" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleRetry(row.id)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusChange(row.id, "resolved")}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Resolve
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusChange(row.id, "abandoned")}
              >
                <Ban className="mr-2 h-4 w-4" />
                Abandon
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Job Failures</h2>
      <p className="mt-1 text-muted-foreground">
        Failed pipeline jobs and queue operations.
      </p>

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
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="retrying">Retrying</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No job failures."
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

      <Dialog
        open={!!selectedFailure}
        onOpenChange={(open) => !open && setSelectedFailure(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Error Detail</DialogTitle>
          </DialogHeader>
          {selectedFailure && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Job Type: </span>
                {selectedFailure.jobType}
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Job Key: </span>
                {selectedFailure.jobKey ?? "--"}
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Error:</span>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-red-50 p-3 font-mono text-xs text-red-800">
                  {selectedFailure.errorMessage}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
