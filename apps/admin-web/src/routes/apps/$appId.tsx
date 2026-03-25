import { useState } from "react";
import { createRoute, Link } from "@tanstack/react-router";
import { rootRoute } from "../__root";
import {
  useApp,
  useAppAliases,
  useAppSources,
  useAppReleases,
  useAppInstallRules,
  useCreateAlias,
  useUpdateAlias,
  useDeleteAlias,
  useTriggerFetch,
  useRecomputeLatest,
} from "@/api/hooks/use-apps";
import type { AppAlias, Source, Release, AppLatestRelease, InstallRule } from "@/api/types";
import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { IdDisplay } from "@/components/shared/id-display";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, ExternalLink, Plus, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";

export const appDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps/$appId",
  component: AppDetailPage,
});

function AppDetailPage() {
  const { appId } = appDetailRoute.useParams();
  const { data: app, isLoading } = useApp(appId);
  const [tab, setTab] = useState("overview");

  if (isLoading) {
    return (
      <div className="space-y-4">
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
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Apps
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">
              {app.canonicalName}
            </h2>
            <StatusBadge status={app.status} />
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <IdDisplay id={app.id} />
            {app.vendorName && <span>{app.vendorName}</span>}
            {app.homepageUrl && (
              <a
                href={app.homepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                Homepage <ExternalLink className="h-3 w-3" />
              </a>
            )}
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
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Latest Releases</h3>
        {app.latestReleases.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No published releases yet.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {app.latestReleases.map((lr) => (
              <div
                key={lr.id}
                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={lr.channel} />
                  <span className="font-mono text-sm font-medium">
                    {lr.versionRaw}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    via {lr.decisionSource}
                  </span>
                </div>
                <TimeAgo date={lr.releasedAt} className="text-sm text-muted-foreground" />
              </div>
            ))}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            recomputeLatest.mutate(
              { appId },
              {
                onSuccess: () => toast.success("Recompute queued"),
                onError: (err) => toast.error(err.message),
              },
            );
          }}
          disabled={recomputeLatest.isPending}
        >
          <RefreshCw className="mr-2 h-3 w-3" />
          Recompute Latest
        </Button>
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Info</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-32">Sources:</dt>
            <dd>{app.sourceCount}</dd>
          </div>
          {app.notes && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-32">Notes:</dt>
              <dd className="whitespace-pre-wrap">{app.notes}</dd>
            </div>
          )}
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

  const columns: Column<AppAlias>[] = [
    {
      key: "aliasType",
      header: "Type",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
          {row.aliasType}
        </span>
      ),
    },
    { key: "value", header: "Value", cell: (row) => <span className="font-mono text-sm">{row.value}</span> },
    { key: "priority", header: "Priority", cell: (row) => row.priority },
    { key: "confidence", header: "Weight", cell: (row) => row.confidenceWeight },
    {
      key: "isActive",
      header: "Active",
      cell: (row) => (
        <Switch
          checked={row.isActive}
          onCheckedChange={(checked) =>
            updateAlias.mutate(
              { id: row.id, isActive: checked },
              { onError: (err) => toast.error(err.message) },
            )
          }
        />
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() =>
            deleteAlias.mutate(row.id, {
              onSuccess: () => toast.success("Alias deleted"),
              onError: (err) => toast.error(err.message),
            })
          }
        >
          Delete
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">Aliases</h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-3 w-3" />
          Add Alias
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isLoading}
        emptyMessage="No aliases configured."
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
  const [aliasType, setAliasType] = useState("bundle_id");
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
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Alias</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Type</Label>
            <Select value={aliasType} onValueChange={setAliasType}>
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
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Value</Label>
            <Input
              placeholder="com.example.app"
              value={value}
              onChange={(e) => setValue(e.target.value)}
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

  const columns: Column<Source>[] = [
    {
      key: "label",
      header: "Label",
      cell: (row) => row.label ?? row.sourceType,
    },
    {
      key: "sourceType",
      header: "Type",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
          {row.sourceType}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "lastFetchedAt",
      header: "Last Fetch",
      cell: (row) => <TimeAgo date={row.lastFetchedAt} />,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            triggerFetch.mutate(
              { sourceId: row.id },
              {
                onSuccess: () => toast.success("Fetch queued"),
                onError: (err) => toast.error(err.message),
              },
            )
          }
          disabled={triggerFetch.isPending}
        >
          <Zap className="mr-1 h-3 w-3" />
          Fetch
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data?.items ?? []}
      isLoading={isLoading}
      emptyMessage="No sources configured."
    />
  );
}

function ReleasesTab({ appId }: { appId: string }) {
  const [offset, setOffset] = useState(0);
  const { data, isLoading } = useAppReleases(appId, { limit: 25, offset });

  const columns: Column<Release>[] = [
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
      key: "releasedAt",
      header: "Released",
      cell: (row) => <TimeAgo date={row.releasedAt} />,
    },
  ];

  return (
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
    />
  );
}

function InstallRulesTab({ appId }: { appId: string }) {
  const { data, isLoading } = useAppInstallRules(appId);

  const columns: Column<InstallRule>[] = [
    {
      key: "strategy",
      header: "Strategy",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
          {row.strategy}
        </span>
      ),
    },
    { key: "requiresQuit", header: "Quit", cell: (row) => (row.requiresQuit ? "Yes" : "No") },
    { key: "requiresAdmin", header: "Admin", cell: (row) => (row.requiresAdmin ? "Yes" : "No") },
    { key: "supportsSilent", header: "Silent", cell: (row) => (row.supportsSilent ? "Yes" : "No") },
    {
      key: "enabled",
      header: "Enabled",
      cell: (row) => <StatusBadge status={row.enabled ? "active" : "disabled"} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data?.items ?? []}
      isLoading={isLoading}
      emptyMessage="No install rules configured."
    />
  );
}
