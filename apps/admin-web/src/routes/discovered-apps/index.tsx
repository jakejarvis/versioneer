import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useDiscoveredApps, useDismissDiscoveredApp } from "@/api/hooks/use-discovered-apps";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/discovered-apps/")({
  component: DiscoveredAppsPage,
});

interface DiscoveredApp {
  id: string;
  lookupKey: string;
  appName: string;
  bundleId: string | null;
  teamId: string | null;
  sightingCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: string;
  onboardedAppId: string | null;
  sampleVersions: string | null;
}

function DiscoveredAppsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "dismissed">("pending");
  const [offset, setOffset] = useState(0);
  const dismissMutation = useDismissDiscoveredApp();

  const { data, isLoading } = useDiscoveredApps({
    status: statusFilter,
    limit: 50,
    offset,
  });

  const handleDismiss = (id: string) => {
    dismissMutation.mutate(id, {
      onSuccess: () => toast.success("Discovered app dismissed"),
      onError: (err) => toast.error(err.message),
    });
  };

  const handleOnboard = (item: DiscoveredApp) => {
    const params = new URLSearchParams();
    params.set("discoveredAppId", item.id);
    params.set("appName", item.appName);
    if (item.bundleId) params.set("bundleId", item.bundleId);
    if (item.teamId) params.set("teamId", item.teamId);
    void navigate({ to: "/onboarding", search: Object.fromEntries(params) });
  };

  const parseVersions = (json: string | null): string[] => {
    if (!json) return [];
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  };

  const columns: Column<DiscoveredApp>[] = [
    {
      key: "appName",
      header: "App",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.appName}</div>
          {row.bundleId && (
            <div className="text-xs font-mono text-muted-foreground">{row.bundleId}</div>
          )}
        </div>
      ),
    },
    {
      key: "sightingCount",
      header: "Sightings",
      cell: (row) => <span className="font-semibold tabular-nums">{row.sightingCount}</span>,
    },
    {
      key: "sampleVersions",
      header: "Versions",
      cell: (row) => {
        const versions = parseVersions(row.sampleVersions);
        if (versions.length === 0) return "--";
        return (
          <span className="text-xs font-mono text-muted-foreground">{versions.join(", ")}</span>
        );
      },
    },
    {
      key: "firstSeenAt",
      header: "First Seen",
      cell: (row) => <TimeAgo date={row.firstSeenAt} />,
    },
    {
      key: "lastSeenAt",
      header: "Last Seen",
      cell: (row) => <TimeAgo date={row.lastSeenAt} />,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        if (row.status === "approved" && row.onboardedAppId) {
          return (
            <Link
              to="/apps/$appId"
              params={{ appId: row.onboardedAppId }}
              className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs font-medium"
            >
              Approved
            </Link>
          );
        }
        return <StatusBadge status={row.status} />;
      },
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        row.status === "pending" ? (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => handleOnboard(row)}>
              Onboard
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleDismiss(row.id)}>Dismiss</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Discovered Apps</h2>
      <p className="mt-1 text-muted-foreground">
        Unmatched apps found during client inventory scans.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as "pending" | "approved" | "dismissed");
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          emptyMessage="No discovered apps."
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
