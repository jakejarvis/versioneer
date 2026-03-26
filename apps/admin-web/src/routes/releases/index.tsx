import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useReleases } from "@/api/hooks/use-releases";
import type { Release } from "@/api/types";
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

export const Route = createFileRoute("/releases/")({
  component: ReleasesPage,
});

function ReleasesPage() {
  const navigate = useNavigate();
  const [channelFilter, setChannelFilter] = useState<"all" | "stable" | "beta" | "nightly">("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "retracted" | "superseded" | "draft"
  >("all");
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useReleases({
    channel: channelFilter !== "all" ? channelFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    limit: 50,
    offset,
  });

  const columns: Column<Release>[] = [
    {
      key: "appId",
      header: "App",
      cell: (row) => <IdDisplay id={row.appId} />,
    },
    {
      key: "versionRaw",
      header: "Version",
      cell: (row) => <span className="font-mono font-medium">{row.versionRaw}</span>,
    },
    {
      key: "channel",
      header: "Channel",
      cell: (row) => <StatusBadge status={row.channel} />,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "isPrerelease",
      header: "Pre",
      cell: (row) => (row.isPrerelease ? "Yes" : ""),
    },
    {
      key: "releasedAt",
      header: "Released",
      cell: (row) => <TimeAgo date={row.releasedAt} />,
    },
    {
      key: "createdAt",
      header: "Created",
      cell: (row) => <TimeAgo date={row.createdAt} />,
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Releases</h2>
      <p className="mt-1 text-muted-foreground">Browse release records across all apps.</p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={channelFilter}
          onValueChange={(v) => {
            setChannelFilter(v as typeof channelFilter);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-40">
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
            <SelectItem value="retracted">Retracted</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No releases found."
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
              to: "/releases/$releaseId",
              params: { releaseId: row.id },
            })
          }
        />
      </div>
    </div>
  );
}
