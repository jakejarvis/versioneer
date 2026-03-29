import { createFileRoute, Link } from "@tanstack/react-router";
import { type ColumnDef, type SortingState } from "@tanstack/react-table";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useDiscoveredApps,
  useDismissDiscoveredApp,
  useReEnrichDiscoveredApp,
} from "@/api/hooks/use-discovered-apps";
import { OnboardingDrawer } from "@/components/onboarding-drawer";
import { AppIcon } from "@/components/shared/app-icon";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
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
import {
  applyPaginationToSearch,
  applySortingToSearch,
  paginatedSearchShape,
  paginationFromSearch,
  sortingFromSearch,
} from "@/lib/data-table-search";

const discoveredAppsSearchSchema = z.object({
  ...paginatedSearchShape,
  status: z.enum(["pending", "linked", "dismissed", "support_only"]).catch("pending"),
});

export const Route = createFileRoute("/discovered-apps/")({
  validateSearch: (search) => discoveredAppsSearchSchema.parse(search),
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
  linkedAppId: string | null;
  sampleVersions: string | null;
  sparkleFeedUrl: string | null;
  electronUpdateUrl: string | null;
  enrichmentStatus: string;
  enrichedVendorName: string | null;
  sourceValidationStatus: string;
  confidenceScore: number | null;
  enrichedLatestVersion: string | null;
  iconR2Key: string | null;
  homebrewCaskToken: string | null;
  homebrewCaskVersion: string | null;
}

function DiscoveredAppsPage() {
  const navigate = Route.useNavigate();
  const searchState = Route.useSearch();
  const pagination = paginationFromSearch(searchState);
  const sorting = sortingFromSearch(searchState);
  const dismissMutation = useDismissDiscoveredApp();
  const reEnrichMutation = useReEnrichDiscoveredApp();

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

  const { data, isLoading } = useDiscoveredApps({
    status: searchState.status,
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: searchState.sortBy,
    sortDir: searchState.sortDir,
  });

  const handleDismiss = useCallback(
    (id: string) => {
      dismissMutation.mutate(id, {
        onSuccess: () => toast.success("Discovered app dismissed"),
        onError: (err) => toast.error(err.message),
      });
    },
    [dismissMutation],
  );

  const handleReEnrich = useCallback(
    (id: string) => {
      reEnrichMutation.mutate(id, {
        onSuccess: () => toast.success("Re-enrichment complete"),
        onError: (err) => toast.error(err.message),
      });
    },
    [reEnrichMutation],
  );

  const handleOnboard = (id: string) => {
    setSelectedAppId(id);
    setDrawerOpen(true);
  };

  const handleOnboardSuccess = (appId: string) => {
    toast.success("Draft created and submitted for review");
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

  const columns = useMemo<ColumnDef<DiscoveredApp>[]>(
    () => [
      {
        accessorKey: "confidenceScore",
        meta: { label: "Score" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Score" />,
        cell: ({ row }) => confidenceBadge(row.original.confidenceScore),
      },
      {
        accessorKey: "appName",
        meta: { label: "App" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="App" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <AppIcon iconR2Key={row.original.iconR2Key} appName={row.original.appName} size={28} />
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.appName}</div>
              {row.original.bundleId ? (
                <div className="truncate text-xs font-mono text-muted-foreground">
                  {row.original.bundleId}
                </div>
              ) : null}
              {row.original.enrichedVendorName ? (
                <div className="truncate text-xs text-muted-foreground">
                  by {row.original.enrichedVendorName}
                </div>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "enrichmentStatus",
        meta: { label: "Enrichment" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Enrichment" />,
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            {enrichmentBadge(row.original.enrichmentStatus)}
            {row.original.sourceValidationStatus === "valid" ? (
              <Badge variant="outline" className="text-[10px] text-emerald-600">
                feed ok
              </Badge>
            ) : null}
            {row.original.homebrewCaskToken ? (
              <Badge
                variant="outline"
                className="text-[10px] text-emerald-600 dark:text-emerald-400"
              >
                brew: {row.original.homebrewCaskToken}
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "enrichedLatestVersion",
        meta: { label: "Latest" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Latest" />,
        cell: ({ row }) => {
          const version = row.original.enrichedLatestVersion ?? row.original.homebrewCaskVersion;
          return version ? (
            <span className="text-xs font-mono">{version}</span>
          ) : (
            <span className="text-xs text-muted-foreground">--</span>
          );
        },
      },
      {
        accessorKey: "sightingCount",
        meta: { label: "Sightings" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sightings" />,
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{row.original.sightingCount}</span>
        ),
      },
      {
        accessorKey: "lastSeenAt",
        meta: { label: "Last Seen" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last Seen" />,
        cell: ({ row }) => <TimeAgo date={row.original.lastSeenAt} />,
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
          if (row.original.status === "linked" && row.original.linkedAppId) {
            return (
              <Link
                to="/apps/$appId"
                params={{ appId: row.original.linkedAppId }}
                className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
              >
                Linked
              </Link>
            );
          }
          return <StatusBadge status={row.original.status} />;
        },
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.status === "pending" ? (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => handleOnboard(row.original.id)}>
                Onboard
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleReEnrich(row.original.id)}>
                    <RefreshCw />
                    Re-enrich
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDismiss(row.original.id)}>
                    Dismiss
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      },
    ],
    [handleDismiss, handleReEnrich],
  );

  const bulkActions: BulkAction<DiscoveredApp>[] = [
    {
      label: "Re-enrich Selected",
      onClick: async (rows) => {
        for (const row of rows) {
          handleReEnrich(row.id);
        }
      },
    },
    {
      label: "Dismiss Selected",
      variant: "destructive",
      onClick: async (rows) => {
        for (const row of rows) {
          handleDismiss(row.id);
        }
      },
    },
  ];

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Discovered Apps</h2>
      <p className="mt-1 text-muted-foreground">
        Unmatched apps found during client inventory scans. Review and onboard high-confidence apps.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Select
          value={searchState.status}
          onValueChange={(value) =>
            void navigate({
              to: "/discovered-apps",
              search: {
                ...searchState,
                page: 1,
                status: value as typeof searchState.status,
              },
            })
          }
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
          sorting={sorting}
          onSortingChange={(updater: SortingState | ((prev: SortingState) => SortingState)) =>
            void navigate({
              to: "/discovered-apps",
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
                      to: "/discovered-apps",
                      search: applyPaginationToSearch(searchState, updater),
                    }),
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
