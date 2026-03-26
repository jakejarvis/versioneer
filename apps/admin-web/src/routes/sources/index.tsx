import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useSources, useTriggerSourceFetch } from "@/api/hooks/use-sources";
import type { Source } from "@/api/types";
import { DataTable, type Column } from "@/components/shared/data-table";
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

export const Route = createFileRoute("/sources/")({
  component: SourcesPage,
});

function SourcesPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "paused" | "disabled" | "error"
  >("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "sparkle" | "github_releases" | "manual">(
    "all",
  );
  const [offset, setOffset] = useState(0);
  const triggerFetch = useTriggerSourceFetch();

  const { data, isLoading } = useSources({
    status: statusFilter !== "all" ? statusFilter : undefined,
    sourceType: typeFilter !== "all" ? typeFilter : undefined,
    limit: 50,
    offset,
  });

  const columns: Column<Source>[] = [
    {
      key: "label",
      header: "Label",
      cell: (row) => <span className="font-medium">{row.label ?? row.sourceType}</span>,
    },
    {
      key: "sourceType",
      header: "Type",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{row.sourceType}</span>
      ),
    },
    {
      key: "parserKey",
      header: "Parser",
      cell: (row) => <span className="font-mono text-xs">{row.parserKey}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "pollInterval",
      header: "Interval",
      cell: (row) => `${row.pollIntervalMinutes}m`,
    },
    {
      key: "lastFetchedAt",
      header: "Last Fetch",
      cell: (row) => <TimeAgo date={row.lastFetchedAt} />,
    },
    {
      key: "lastSuccessAt",
      header: "Last Success",
      cell: (row) => <TimeAgo date={row.lastSuccessAt} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            triggerFetch.mutate(
              { sourceId: row.id },
              {
                onSuccess: () => toast.success("Fetch queued"),
                onError: (err) => toast.error(err.message),
              },
            );
          }}
        >
          <Zap className="mr-1 h-3 w-3" />
          Fetch
        </Button>
      ),
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Sources</h2>
      <p className="mt-1 text-muted-foreground">
        Manage update data sources and their fetch pipelines.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as typeof statusFilter);
            setOffset(0);
          }}
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
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v as typeof typeFilter);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="sparkle">Sparkle</SelectItem>
            <SelectItem value="github_releases">GitHub Releases</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No sources found."
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
          onRowClick={(row) =>
            navigate({
              to: "/sources/$sourceId",
              params: { sourceId: row.id },
            })
          }
        />
      </div>
    </div>
  );
}
