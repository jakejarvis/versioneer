import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import {
  ArrowLeft,
  ExternalLink,
  GripVertical,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  Upload,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  useApp,
  useAppAliases,
  useAppReleases,
  useAppSources,
  useCreateAlias,
  useDeleteAlias,
  useDeleteAppIcon,
  useRecomputeLatest,
  useTriggerFetch,
  useUpdateAlias,
  useUploadAppIcon,
} from "@/api/hooks/use-apps";
import { useReorderSources } from "@/api/hooks/use-sources";
import type { AppAlias, AppLatestRelease, Release, Source } from "@/api/types";
import { AppIcon } from "@/components/shared/app-icon";
import { CreateSourceDialog } from "@/components/shared/create-source-dialog";
import { DataTable, type BulkAction } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { EditAppDialog } from "@/components/shared/edit-app-dialog";
import { SourceEntityLink } from "@/components/shared/entity-link";
import { FormField } from "@/components/shared/form-field";
import { IdDisplay } from "@/components/shared/id-display";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyDescription } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/apps/$appId")({
  component: AppDetailPage,
});

function AppDetailPage() {
  const { appId } = Route.useParams();
  const { data: app, isLoading } = useApp(appId);
  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
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
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyDescription>App not found.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
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
              {app.status === "public" ? (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Public
                </span>
              ) : null}
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
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="aliases">Aliases</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="releases">Releases</TabsTrigger>
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
      </Tabs>

      <EditAppDialog app={app} open={editOpen} onOpenChange={setEditOpen} />
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
          <Empty className="mt-3">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Upload />
              </EmptyMedia>
              <EmptyDescription>No published releases.</EmptyDescription>
            </EmptyHeader>
          </Empty>
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
                    {latestRelease.installStrategy ? (
                      <span>Strategy: {latestRelease.installStrategy}</span>
                    ) : null}
                    {latestRelease.pinnedReleaseId ? <span>Pinned</span> : null}
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
  const updateAlias = useUpdateAlias(appId);
  const deleteAlias = useDeleteAlias(appId);

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

  const bulkActions: BulkAction<AppAlias>[] = [
    {
      label: "Activate Selected",
      disabled: updateAlias.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          updateAlias.mutate(
            { id: row.id, isActive: true },
            { onError: (err) => toast.error(err.message) },
          );
        }
        toast.success(`Activated ${rows.length} alias${rows.length === 1 ? "" : "es"}`);
      },
    },
    {
      label: "Deactivate Selected",
      disabled: updateAlias.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          updateAlias.mutate(
            { id: row.id, isActive: false },
            { onError: (err) => toast.error(err.message) },
          );
        }
        toast.success(`Deactivated ${rows.length} alias${rows.length === 1 ? "" : "es"}`);
      },
    },
    {
      label: "Delete Selected",
      variant: "destructive",
      disabled: deleteAlias.isPending,
      onClick: async (rows) => {
        for (const row of rows) {
          deleteAlias.mutate(row.id, { onError: (err) => toast.error(err.message) });
        }
        toast.success(`Deleted ${rows.length} alias${rows.length === 1 ? "" : "es"}`);
      },
    },
  ];

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
        enableRowSelection
        bulkActions={bulkActions}
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <CreateAliasForm appId={appId} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function CreateAliasForm({
  appId,
  onOpenChange,
}: {
  appId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const createAlias = useCreateAlias(appId);

  const form = useForm({
    defaultValues: {
      aliasType: "bundle_id" as
        | "bundle_id"
        | "name"
        | "team_id"
        | "sparkle_feed"
        | "homepage"
        | "download_pattern"
        | "github_repo"
        | "mas_app_id",
      value: "",
    },
    onSubmit: async ({ value }) => {
      createAlias.mutate(
        { aliasType: value.aliasType, value: value.value },
        {
          onSuccess: () => {
            toast.success("Alias created");
            onOpenChange(false);
          },
          onError: (error) => toast.error(error.message),
        },
      );
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add Alias</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <form.Field name="aliasType">
          {(field) => (
            <FormField label="Type" name={field.name} meta={field.state.meta}>
              <Select
                value={field.state.value}
                onValueChange={(v) => field.handleChange(v as typeof field.state.value)}
              >
                <SelectTrigger id={field.name}>
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
            </FormField>
          )}
        </form.Field>
        <form.Field
          name="value"
          validators={{
            onBlur: ({ value }) => (!value ? "Value is required" : undefined),
          }}
        >
          {(field) => (
            <FormField label="Value" name={field.name} meta={field.state.meta}>
              <Input
                id={field.name}
                placeholder="com.example.app"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              />
            </FormField>
          )}
        </form.Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting || createAlias.isPending}>
                {createAlias.isPending ? "Adding..." : "Add"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </form>
    </>
  );
}

function SortableSourceRow({
  source,
  index,
  onFetch,
}: {
  source: Source;
  index: number;
  onFetch: (id: string) => void;
}) {
  const { ref } = useSortable({ id: source.id, index });

  return (
    <div
      ref={ref}
      className="flex items-center gap-3 rounded-lg border bg-card p-3 text-[13px] shadow-sm"
    >
      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <SourceEntityLink
          source={{
            id: source.id,
            label: source.label,
            sourceType: source.sourceType,
            parserKey: source.parserKey,
            channel: source.channel,
            reviewStatus: source.reviewStatus,
            role: source.role,
            status: source.status,
            app: null,
          }}
          showId
        />
      </div>
      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{source.sourceType}</span>
      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
        {source.channel ?? "auto"}
      </span>
      <StatusBadge status={source.status} />
      <TimeAgo date={source.lastSuccessAt} />
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/sources/$sourceId" params={{ sourceId: source.id }}>
            Open
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => onFetch(source.id)}>
          <Zap />
          Fetch
        </Button>
      </div>
    </div>
  );
}

function SourcesTab({ appId }: { appId: string }) {
  const { data, isLoading } = useAppSources(appId);
  const triggerFetch = useTriggerFetch();
  const reorderMutation = useReorderSources();
  const [createSourceOpen, setCreateSourceOpen] = useState(false);

  const sortedSources = useMemo(() => {
    const items = data?.items ?? [];
    return [...items].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  }, [data?.items]);

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

  const handleDragEnd = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      if (event.canceled) return;
      const { source } = event.operation;
      if (!source || !isSortable(source)) return;

      const { initialIndex, index: newIndex } = source.sortable;
      if (initialIndex === newIndex) return;

      const reordered = [...sortedSources];
      const [moved] = reordered.splice(initialIndex, 1);
      reordered.splice(newIndex, 0, moved!);

      reorderMutation.mutate(
        { appId, sourceIds: reordered.map((s) => s.id) },
        {
          onSuccess: () => toast.success("Sources reordered"),
          onError: (err: Error) => toast.error(err.message),
        },
      );
    },
    [sortedSources, appId, reorderMutation],
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-medium">Sources</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Update feeds that provide release information for this app. Drag to reorder; the first
            source is primary.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateSourceOpen(true)}>
          <Plus />
          Add Source
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : sortedSources.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Unplug />
            </EmptyMedia>
            <EmptyDescription>No sources configured.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DragDropProvider onDragEnd={handleDragEnd}>
          <div className="space-y-2">
            {sortedSources.map((source, index) => (
              <SortableSourceRow
                key={source.id}
                source={source}
                index={index}
                onFetch={queueFetch}
              />
            ))}
          </div>
        </DragDropProvider>
      )}
      <CreateSourceDialog
        appId={appId}
        open={createSourceOpen}
        onOpenChange={setCreateSourceOpen}
      />
    </div>
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
      emptyMessage="No releases."
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
