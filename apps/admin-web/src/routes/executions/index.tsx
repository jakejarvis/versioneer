import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { useExecutions } from "@/api/hooks/use-executions";
import type { UpdateExecution } from "@/api/types";
import { DataTable, type Column } from "@/components/shared/data-table";
import { IdDisplay } from "@/components/shared/id-display";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/executions/")({
  component: ExecutionsPage,
});

function ExecutionsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useExecutions({
    actionStatus: statusFilter !== "all" ? statusFilter : undefined,
    limit: 50,
    offset,
  });

  const columns: Column<UpdateExecution>[] = [
    {
      key: "actionType",
      header: "Action",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{row.actionType}</span>
      ),
    },
    {
      key: "appId",
      header: "App",
      cell: (row) => (
        <Link
          to="/apps/$appId"
          params={{ appId: row.appId }}
          className="text-blue-600 hover:underline"
        >
          <IdDisplay id={row.appId} />
        </Link>
      ),
    },
    {
      key: "actionStatus",
      header: "Status",
      cell: (row) => <StatusBadge status={row.actionStatus} />,
    },
    {
      key: "installabilityClass",
      header: "Class",
      cell: (row) =>
        row.installabilityClass ? <StatusBadge status={row.installabilityClass} /> : "--",
    },
    {
      key: "durationMs",
      header: "Duration",
      cell: (row) => (row.durationMs ? `${row.durationMs}ms` : "--"),
    },
    {
      key: "initiatedAt",
      header: "Initiated",
      cell: (row) => <TimeAgo date={row.initiatedAt} />,
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Executions</h2>
      <p className="mt-1 text-muted-foreground">Client update execution audit trail.</p>

      <div className="mt-4 flex items-center gap-3">
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
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="initiated">Initiated</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No execution records."
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
    </div>
  );
}
