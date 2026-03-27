import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  useDiscoveredApps,
  useDismissDiscoveredApp,
  useReEnrichDiscoveredApp,
} from "@/api/hooks/use-discovered-apps";
import { OnboardingDrawer } from "@/components/onboarding-drawer";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
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
  sparkleFeedUrl: string | null;
  electronUpdateUrl: string | null;
  enrichmentStatus: string;
  enrichedVendorName: string | null;
  sourceValidationStatus: string;
  confidenceScore: number | null;
  enrichedLatestVersion: string | null;
}

function DiscoveredAppsPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<
    "pending" | "approved" | "dismissed" | "mas_app"
  >("pending");
  const [offset, setOffset] = useState(0);
  const dismissMutation = useDismissDiscoveredApp();
  const reEnrichMutation = useReEnrichDiscoveredApp();

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

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

  const handleReEnrich = (id: string) => {
    reEnrichMutation.mutate(id, {
      onSuccess: () => toast.success("Re-enrichment complete"),
      onError: (err) => toast.error(err.message),
    });
  };

  const handleOnboard = (id: string) => {
    setSelectedAppId(id);
    setDrawerOpen(true);
  };

  const handleOnboardSuccess = (appId: string) => {
    toast.success("App onboarded successfully");
    void navigate({ to: "/apps/$appId", params: { appId } });
  };

  const confidenceBadge = (score: number | null) => {
    if (score === null) return <span className="text-xs text-muted-foreground">--</span>;
    const color =
      score >= 70
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400"
        : score >= 40
          ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400"
          : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400";
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${color}`}
      >
        {score}
      </span>
    );
  };

  const enrichmentBadge = (status: string) => {
    switch (status) {
      case "success":
        return (
          <Badge variant="default" className="text-[10px]">
            enriched
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="text-[10px]">
            failed
          </Badge>
        );
      case "in_progress":
        return (
          <Badge variant="secondary" className="text-[10px]">
            enriching...
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px]">
            pending
          </Badge>
        );
    }
  };

  const columns: Column<DiscoveredApp>[] = [
    {
      key: "confidenceScore",
      header: "Score",
      cell: (row) => confidenceBadge(row.confidenceScore),
    },
    {
      key: "appName",
      header: "App",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.appName}</div>
          {row.bundleId && (
            <div className="text-xs font-mono text-muted-foreground">{row.bundleId}</div>
          )}
          {row.enrichedVendorName && (
            <div className="text-xs text-muted-foreground">by {row.enrichedVendorName}</div>
          )}
        </div>
      ),
    },
    {
      key: "enrichmentStatus",
      header: "Enrichment",
      cell: (row) => (
        <div className="flex flex-col gap-1">
          {enrichmentBadge(row.enrichmentStatus)}
          {row.sourceValidationStatus === "valid" && (
            <Badge variant="outline" className="text-[10px] text-emerald-600">
              feed ok
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "enrichedLatestVersion",
      header: "Latest",
      cell: (row) =>
        row.enrichedLatestVersion ? (
          <span className="text-xs font-mono">{row.enrichedLatestVersion}</span>
        ) : (
          <span className="text-xs text-muted-foreground">--</span>
        ),
    },
    {
      key: "sightingCount",
      header: "Sightings",
      cell: (row) => <span className="font-semibold tabular-nums">{row.sightingCount}</span>,
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
            <Button variant="outline" size="sm" onClick={() => handleOnboard(row.id)}>
              Onboard
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => handleReEnrich(row.id)}>
                  <RefreshCw className="mr-2 h-3 w-3" />
                  Re-enrich
                </DropdownMenuItem>
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
        Unmatched apps found during client inventory scans. Review and onboard high-confidence apps.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as typeof statusFilter);
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
            <SelectItem value="mas_app">MAS Apps</SelectItem>
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

      <OnboardingDrawer
        discoveredAppId={selectedAppId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onSuccess={handleOnboardSuccess}
      />
    </div>
  );
}
