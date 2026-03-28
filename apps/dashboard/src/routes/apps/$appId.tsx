import { createFileRoute, Link } from "@tanstack/react-router";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import {
  ArrowLeft,
  BarChart3,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  useApp,
  useAppAliases,
  useAppInstallRules,
  useAppReleases,
  useAppSources,
  useCreateAlias,
  useCreateInstallRule,
  useDeleteAlias,
  useDeleteAppIcon,
  useDeleteInstallRule,
  useRecomputeLatest,
  useTriggerFetch,
  useUpdateAlias,
  useUpdateInstallRule,
  useUploadAppIcon,
} from "@/api/hooks/use-apps";
import { useOnboardingChecklist, useUpdateOnboardingChecklist } from "@/api/hooks/use-onboarding";
import {
  usePromoteVerification,
  useRecomputeScorecard,
  useScorecard,
} from "@/api/hooks/use-scorecards";
import type { AppAlias, AppLatestRelease, InstallRule, Release, Source } from "@/api/types";
import { AppIcon } from "@/components/shared/app-icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { DecisionExplanationCard } from "@/components/shared/decision-explanation";
import { SourceEntityLink } from "@/components/shared/entity-link";
import { IdDisplay } from "@/components/shared/id-display";
import { OnboardingChecklistCard } from "@/components/shared/onboarding-checklist";
import { QualityBadge } from "@/components/shared/quality-badge";
import { ScorecardCard } from "@/components/shared/scorecard-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { VerificationBadge } from "@/components/shared/verification-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/apps/$appId")({
  component: AppDetailPage,
});

const installStrategies = [
  "sparkle",
  "zip_replace",
  "dmg_copy_replace",
  "pkg_install",
  "pkg_manual",
  "manual_only",
] as const;

type InstallStrategy = (typeof installStrategies)[number];

const defaultInstallRuleForm = {
  strategy: "sparkle" as InstallStrategy,
  requiresQuit: false,
  requiresAdmin: false,
  supportsSilent: true,
  rollbackSupported: false,
  ruleConfidence: "80",
  notes: "",
  enabled: true,
};

function AppDetailPage() {
  const { appId } = Route.useParams();
  const { data: app, isLoading } = useApp(appId);
  const [tab, setTab] = useState("overview");
  const uploadIconMutation = useUploadAppIcon(appId);
  const deleteIconMutation = useDeleteAppIcon(appId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!app) {
    return <p className="text-muted-foreground">App not found.</p>;
  }

  return (
    <div>
      <Link
        to="/apps"
        search={{ page: 1, pageSize: 50, search: "", status: "all" }}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Apps
      </Link>

      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="group relative">
            <AppIcon iconR2Key={app.iconR2Key} appName={app.canonicalName} size={48} />
            <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-md bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded p-1 text-white hover:bg-white/20"
                title="Upload icon"
              >
                <Upload className="h-4 w-4" />
              </button>
              {app.iconR2Key ? (
                <button
                  type="button"
                  onClick={() => {
                    deleteIconMutation.mutate(undefined, {
                      onSuccess: () => toast.success("Icon deleted"),
                      onError: (error) => toast.error(error.message),
                    });
                  }}
                  className="rounded p-1 text-white hover:bg-white/20"
                  title="Delete icon"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  uploadIconMutation.mutate(file, {
                    onSuccess: () => toast.success("Icon uploaded"),
                    onError: (error) => toast.error(error.message),
                  });
                }
                event.target.value = "";
              }}
            />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight">{app.canonicalName}</h2>
              <StatusBadge status={app.status} />
              <QualityBadge state={app.qualityState} />
              <VerificationBadge tier={app.verificationTier} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <IdDisplay id={app.id} />
              {app.vendorName ? <span>{app.vendorName}</span> : null}
              <span>{app.slug}</span>
              {app.homepageUrl ? (
                <a
                  href={app.homepageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  Homepage <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="aliases">Aliases</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="releases">Releases</TabsTrigger>
          <TabsTrigger value="install-rules">Install Rules</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab appId={appId} app={app} />
        </TabsContent>
        <TabsContent value="aliases" className="mt-4">
          <AliasesTab appId={appId} />
        </TabsContent>
        <TabsContent value="sources" className="mt-4">
          <SourcesTab appId={appId} />
        </TabsContent>
        <TabsContent value="releases" className="mt-4">
          <ReleasesTab appId={appId} />
        </TabsContent>
        <TabsContent value="install-rules" className="mt-4">
          <InstallRulesTab appId={appId} />
        </TabsContent>
        <TabsContent value="quality" className="mt-4">
          <QualityTab
            appId={appId}
            verificationTier={app.verificationTier}
            latestReleases={app.latestReleases ?? []}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({
  appId,
  app,
}: {
  appId: string;
  app: { notes: string | null; sourceCount: number; latestReleases: AppLatestRelease[] };
}) {
  const recomputeLatest = useRecomputeLatest();

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium">Latest Releases</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Cross-linked publication decisions for each channel.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              recomputeLatest.mutate(
                { appId },
                {
                  onSuccess: () => toast.success("Recompute queued"),
                  onError: (error) => toast.error(error.message),
                },
              );
            }}
            disabled={recomputeLatest.isPending}
          >
            <RefreshCw />
            Recompute Latest
          </Button>
        </div>
        {app.latestReleases.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No published releases yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {app.latestReleases.map((latestRelease) => (
              <Link
                key={latestRelease.id}
                to="/releases/$releaseId"
                params={{ releaseId: latestRelease.releaseId }}
                className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-3 hover:bg-muted/50"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={latestRelease.channel} />
                    <span className="font-mono text-sm font-medium">
                      {latestRelease.versionRaw}
                    </span>
                    <IdDisplay id={latestRelease.releaseId} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Decision: {latestRelease.decisionSource}</span>
                    {latestRelease.installabilityClass ? (
                      <span>Installability: {latestRelease.installabilityClass}</span>
                    ) : null}
                    {latestRelease.confidence != null ? (
                      <span>Confidence: {latestRelease.confidence}</span>
                    ) : null}
                  </div>
                </div>
                <TimeAgo
                  date={latestRelease.releasedAt}
                  className="text-sm text-muted-foreground"
                />
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Info</h3>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex gap-2">
            <dt className="w-32 text-muted-foreground">Sources:</dt>
            <dd>{app.sourceCount}</dd>
          </div>
          {app.notes ? (
            <div className="flex gap-2">
              <dt className="w-32 text-muted-foreground">Notes:</dt>
              <dd className="whitespace-pre-wrap">{app.notes}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}

function AliasesTab({ appId }: { appId: string }) {
  const { data, isLoading } = useAppAliases(appId);
  const [createOpen, setCreateOpen] = useState(false);
  const updateAlias = useUpdateAlias();
  const deleteAlias = useDeleteAlias();

  const columns = useMemo<ColumnDef<AppAlias>[]>(
    () => [
      {
        accessorKey: "aliasType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.aliasType}
          </span>
        ),
      },
      {
        accessorKey: "value",
        meta: { label: "Alias" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Alias" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-mono text-sm">{row.original.value}</span>
            <span className="truncate text-xs text-muted-foreground">
              normalized: {row.original.normalizedValue}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "isExact",
        meta: { label: "Match" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Match" />,
        cell: ({ row }) => (row.original.isExact ? "Exact" : "Normalized"),
      },
      {
        accessorKey: "source",
        meta: { label: "Source" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => row.original.source ?? "--",
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Created" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <TimeAgo date={row.original.createdAt} />,
      },
      {
        accessorKey: "isActive",
        meta: { label: "Active" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />,
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            onCheckedChange={(checked) =>
              updateAlias.mutate(
                { id: row.original.id, isActive: checked },
                { onError: (error) => toast.error(error.message) },
              )
            }
          />
        ),
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() =>
              deleteAlias.mutate(row.original.id, {
                onSuccess: () => toast.success("Alias deleted"),
                onError: (error) => toast.error(error.message),
              })
            }
          >
            Delete
          </Button>
        ),
      },
    ],
    [deleteAlias, updateAlias],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-medium">Aliases</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Exact and normalized identifiers used to match this app.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          Add Alias
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        emptyMessage="No aliases configured."
        enableColumnVisibility
      />
      <CreateAliasDialog appId={appId} open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CreateAliasDialog({
  appId,
  open,
  onOpenChange,
}: {
  appId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [aliasType, setAliasType] = useState<
    | "bundle_id"
    | "name"
    | "team_id"
    | "sparkle_feed"
    | "homepage"
    | "download_pattern"
    | "github_repo"
    | "mas_app_id"
  >("bundle_id");
  const [value, setValue] = useState("");
  const createAlias = useCreateAlias(appId);

  const handleSubmit = () => {
    createAlias.mutate(
      { aliasType, value },
      {
        onSuccess: () => {
          toast.success("Alias created");
          onOpenChange(false);
          setValue("");
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Alias</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Type</Label>
            <Select
              value={aliasType}
              onValueChange={(nextAliasType) => setAliasType(nextAliasType as typeof aliasType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bundle_id">Bundle ID</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="team_id">Team ID</SelectItem>
                <SelectItem value="sparkle_feed">Sparkle Feed</SelectItem>
                <SelectItem value="homepage">Homepage</SelectItem>
                <SelectItem value="download_pattern">Download Pattern</SelectItem>
                <SelectItem value="github_repo">GitHub Repo</SelectItem>
                <SelectItem value="mas_app_id">App Store ID</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Value</Label>
            <Input
              placeholder="com.example.app"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!value || createAlias.isPending}>
            {createAlias.isPending ? "Adding..." : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourcesTab({ appId }: { appId: string }) {
  const { data, isLoading } = useAppSources(appId);
  const triggerFetch = useTriggerFetch();

  const queueFetch = useCallback(
    (sourceId: string) => {
      triggerFetch.mutate(
        { sourceId },
        {
          onSuccess: () => toast.success("Fetch queued"),
          onError: (error) => toast.error(error.message),
        },
      );
    },
    [triggerFetch],
  );

  const columns = useMemo<ColumnDef<Source>[]>(
    () => [
      {
        accessorKey: "label",
        meta: { label: "Source" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
        cell: ({ row }) => (
          <SourceEntityLink
            source={{
              id: row.original.id,
              label: row.original.label,
              sourceType: row.original.sourceType,
              parserKey: row.original.parserKey,
              status: row.original.status,
              app: null,
            }}
            showId
          />
        ),
      },
      {
        accessorKey: "sourceType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.sourceType}
          </span>
        ),
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "lastFetchedAt",
        meta: { label: "Last Fetch" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last Fetch" />,
        cell: ({ row }) => <TimeAgo date={row.original.lastFetchedAt} />,
      },
      {
        accessorKey: "lastSuccessAt",
        meta: { label: "Last Success" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Last Success" />,
        cell: ({ row }) => <TimeAgo date={row.original.lastSuccessAt} />,
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/sources/$sourceId" params={{ sourceId: row.original.id }}>
                Open
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => queueFetch(row.original.id)}>
              <Zap />
              Fetch
            </Button>
          </div>
        ),
      },
    ],
    [queueFetch],
  );

  return (
    <DataTable
      columns={columns}
      data={data?.items ?? []}
      isLoading={isLoading}
      emptyMessage="No sources configured."
      enableColumnVisibility
    />
  );
}

function ReleasesTab({ appId }: { appId: string }) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const { data, isLoading } = useAppReleases(appId, {
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
    sortBy: sorting[0]?.id,
    sortDir: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
  });

  const columns = useMemo<ColumnDef<Release>[]>(
    () => [
      {
        accessorKey: "versionRaw",
        meta: { label: "Release" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Release" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <Link
                to="/releases/$releaseId"
                params={{ releaseId: row.original.id }}
                className="truncate font-mono font-medium hover:text-foreground"
              >
                {row.original.versionRaw}
              </Link>
              <IdDisplay id={row.original.id} />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{row.original.versionNormalized}</span>
              {row.original.buildNumber ? <span>Build {row.original.buildNumber}</span> : null}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "channel",
        meta: { label: "Channel" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Channel" />,
        cell: ({ row }) => <StatusBadge status={row.original.channel} />,
      },
      {
        accessorKey: "status",
        meta: { label: "Status" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "releasedAt",
        meta: { label: "Released" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Released" />,
        cell: ({ row }) => <TimeAgo date={row.original.releasedAt} />,
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
          <Button asChild variant="ghost" size="sm">
            <Link to="/releases/$releaseId" params={{ releaseId: row.original.id }}>
              Open
            </Link>
          </Button>
        ),
      },
    ],
    [],
  );

  const pageCount = data ? Math.max(1, Math.ceil(data.total / pagination.pageSize)) : 0;

  return (
    <DataTable
      columns={columns}
      data={data?.items ?? []}
      isLoading={isLoading}
      emptyMessage="No releases found."
      sorting={sorting}
      onSortingChange={setSorting}
      manualSorting
      enableColumnVisibility
      pagination={
        data
          ? {
              total: data.total,
              pageIndex: pagination.pageIndex,
              pageSize: pagination.pageSize,
              pageCount,
              onPaginationChange: setPagination,
            }
          : undefined
      }
    />
  );
}

function QualityTab({
  appId,
  verificationTier,
  latestReleases,
}: {
  appId: string;
  verificationTier: string;
  latestReleases: AppLatestRelease[];
}) {
  const { data: scorecard, isLoading: scorecardLoading } = useScorecard(appId);
  const { data: checklist } = useOnboardingChecklist(appId);
  const recomputeScorecard = useRecomputeScorecard();
  const promoteVerification = usePromoteVerification();
  const updateChecklist = useUpdateOnboardingChecklist(appId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Quality & Verification</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              recomputeScorecard.mutate(appId, {
                onSuccess: () => toast.success("Scorecard recomputed"),
                onError: (error) => toast.error(error.message),
              })
            }
            disabled={recomputeScorecard.isPending}
          >
            <BarChart3 />
            Recompute Scorecard
          </Button>
          {verificationTier !== "verified" ? (
            <Button
              size="sm"
              onClick={() =>
                promoteVerification.mutate(appId, {
                  onSuccess: (data) => toast.success(`Promoted to ${data.verificationTier}`),
                  onError: (error) => toast.error(error.message),
                })
              }
              disabled={promoteVerification.isPending}
            >
              Promote Verification
            </Button>
          ) : null}
        </div>
      </div>

      {scorecardLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : scorecard ? (
        <ScorecardCard scorecard={scorecard} />
      ) : (
        <p className="text-sm text-muted-foreground">
          No scorecard data yet. Click &quot;Recompute Scorecard&quot; to generate.
        </p>
      )}

      {latestReleases.map((latestRelease) =>
        latestRelease.decisionExplanationJson ? (
          <div key={latestRelease.id}>
            <h4 className="mb-2 text-sm font-medium">
              Decision Explanation ({latestRelease.channel})
            </h4>
            <DecisionExplanationCard
              explanation={JSON.parse(latestRelease.decisionExplanationJson).publication}
            />
          </div>
        ) : null,
      )}

      {checklist ? (
        <OnboardingChecklistCard
          checklist={checklist}
          onToggle={(key, value) =>
            updateChecklist.mutate(
              { [key]: value },
              { onError: (error) => toast.error(error.message) },
            )
          }
        />
      ) : null}
    </div>
  );
}

function InstallRulesTab({ appId }: { appId: string }) {
  const { data, isLoading } = useAppInstallRules(appId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<InstallRule | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
  const updateInstallRule = useUpdateInstallRule(appId);
  const deleteInstallRule = useDeleteInstallRule(appId);

  const toggleInstallRule = useCallback(
    (id: string, enabled: boolean) => {
      updateInstallRule.mutate(
        { id, enabled },
        {
          onSuccess: () =>
            toast.success(enabled ? "Install rule enabled" : "Install rule disabled"),
          onError: (error) => toast.error(error.message),
        },
      );
    },
    [updateInstallRule],
  );

  const columns = useMemo<ColumnDef<InstallRule>[]>(
    () => [
      {
        accessorKey: "strategy",
        meta: { label: "Strategy" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Strategy" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.strategy}
          </span>
        ),
      },
      {
        id: "capabilities",
        meta: { label: "Capabilities" },
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <span>
              Quit: {row.original.requiresQuit ? "Required" : "No"} · Admin:{" "}
              {row.original.requiresAdmin ? "Required" : "No"}
            </span>
            <span className="text-xs text-muted-foreground">
              Silent: {row.original.supportsSilent ? "Supported" : "No"} · Rollback:{" "}
              {row.original.rollbackSupported ? "Supported" : "No"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "ruleConfidence",
        meta: { label: "Confidence" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Confidence" />,
        cell: ({ row }) =>
          row.original.ruleConfidence != null ? `${row.original.ruleConfidence}%` : "--",
      },
      {
        accessorKey: "notes",
        meta: { label: "Notes" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Notes" />,
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="block max-w-72 truncate text-sm">{row.original.notes}</span>
          ) : (
            "--"
          ),
      },
      {
        accessorKey: "updatedAt",
        meta: { label: "Updated" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
        cell: ({ row }) => <TimeAgo date={row.original.updatedAt} />,
      },
      {
        accessorKey: "enabled",
        meta: { label: "Enabled" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Enabled" />,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            onCheckedChange={(enabled) => toggleInstallRule(row.original.id, enabled)}
          />
        ),
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingRule(row.original);
                setDialogOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setDeleteRuleId(row.original.id)}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [toggleInstallRule],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-medium">Install Rules</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Operational strategies and installability constraints for this app.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingRule(null);
            setDialogOpen(true);
          }}
        >
          <Plus />
          Add Rule
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        emptyMessage="No install rules configured."
        enableColumnVisibility
      />
      <InstallRuleDialog
        appId={appId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editingRule}
      />
      <ConfirmDialog
        open={Boolean(deleteRuleId)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteRuleId(null);
          }
        }}
        title="Delete Install Rule"
        description="This will remove the install rule from the app configuration."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteInstallRule.isPending}
        onConfirm={() => {
          if (!deleteRuleId) {
            return;
          }

          deleteInstallRule.mutate(deleteRuleId, {
            onSuccess: () => {
              toast.success("Install rule deleted");
              setDeleteRuleId(null);
            },
            onError: (error) => toast.error(error.message),
          });
        }}
      />
    </div>
  );
}

function InstallRuleDialog({
  appId,
  open,
  onOpenChange,
  rule,
}: {
  appId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: InstallRule | null;
}) {
  const createInstallRule = useCreateInstallRule(appId);
  const updateInstallRule = useUpdateInstallRule(appId);
  const [form, setForm] = useState(defaultInstallRuleForm);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (rule) {
      setForm({
        strategy: rule.strategy,
        requiresQuit: rule.requiresQuit,
        requiresAdmin: rule.requiresAdmin,
        supportsSilent: rule.supportsSilent,
        rollbackSupported: rule.rollbackSupported,
        ruleConfidence: rule.ruleConfidence != null ? String(rule.ruleConfidence) : "",
        notes: rule.notes ?? "",
        enabled: rule.enabled,
      });
      return;
    }

    setForm(defaultInstallRuleForm);
  }, [open, rule]);

  const isPending = createInstallRule.isPending || updateInstallRule.isPending;

  const handleSubmit = () => {
    const parsedConfidence = form.ruleConfidence.trim()
      ? Number.parseInt(form.ruleConfidence, 10)
      : null;

    if (parsedConfidence != null && Number.isNaN(parsedConfidence)) {
      toast.error("Confidence must be a number.");
      return;
    }

    const payload = {
      strategy: form.strategy,
      requiresQuit: form.requiresQuit,
      requiresAdmin: form.requiresAdmin,
      supportsSilent: form.supportsSilent,
      rollbackSupported: form.rollbackSupported,
      ruleConfidence: parsedConfidence,
      notes: form.notes.trim() || null,
    };

    if (rule) {
      updateInstallRule.mutate(
        {
          id: rule.id,
          ...payload,
          enabled: form.enabled,
        },
        {
          onSuccess: () => {
            toast.success("Install rule updated");
            onOpenChange(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }

    createInstallRule.mutate(
      {
        ...payload,
        ruleConfidence: parsedConfidence ?? undefined,
        notes: form.notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Install rule created");
          onOpenChange(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit Install Rule" : "Add Install Rule"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Strategy</Label>
            <Select
              value={form.strategy}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, strategy: value as InstallStrategy }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sparkle">Sparkle</SelectItem>
                <SelectItem value="zip_replace">ZIP Replace</SelectItem>
                <SelectItem value="dmg_copy_replace">DMG Copy Replace</SelectItem>
                <SelectItem value="pkg_install">PKG Install</SelectItem>
                <SelectItem value="pkg_manual">PKG Manual</SelectItem>
                <SelectItem value="manual_only">Manual Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label>Requires Quit</Label>
            <Switch
              checked={form.requiresQuit}
              onCheckedChange={(requiresQuit) =>
                setForm((current) => ({ ...current, requiresQuit }))
              }
            />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label>Requires Admin</Label>
            <Switch
              checked={form.requiresAdmin}
              onCheckedChange={(requiresAdmin) =>
                setForm((current) => ({ ...current, requiresAdmin }))
              }
            />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label>Supports Silent Install</Label>
            <Switch
              checked={form.supportsSilent}
              onCheckedChange={(supportsSilent) =>
                setForm((current) => ({ ...current, supportsSilent }))
              }
            />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label>Rollback Supported</Label>
            <Switch
              checked={form.rollbackSupported}
              onCheckedChange={(rollbackSupported) =>
                setForm((current) => ({ ...current, rollbackSupported }))
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Rule Confidence</Label>
            <Input
              inputMode="numeric"
              value={form.ruleConfidence}
              onChange={(event) =>
                setForm((current) => ({ ...current, ruleConfidence: event.target.value }))
              }
            />
          </div>
          {rule ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label>Enabled</Label>
              <Switch
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea
              rows={4}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : rule ? "Save Changes" : "Create Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
