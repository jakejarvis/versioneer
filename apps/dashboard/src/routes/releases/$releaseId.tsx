import { createFileRoute, Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, ExternalLink, Inbox, Pencil, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/shared/data-table";
import { DataTableColumnHeader } from "@/components/shared/data-table-column-header";
import { AppEntityLink } from "@/components/shared/entity-link";
import { IdDisplay } from "@/components/shared/id-display";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  usePinRelease,
  useRelease,
  useReleaseArtifacts,
  useReleaseObservations,
  useUnpinRelease,
  useUpdateRelease,
} from "@/hooks/use-releases";
import type { Artifact, ReleaseObservation } from "@/lib/types";

export const Route = createFileRoute("/releases/$releaseId")({
  component: ReleaseDetailPage,
});

function ReleaseDetailPage() {
  const { releaseId } = Route.useParams();
  const { data: release, isLoading } = useRelease(releaseId);
  const updateRelease = useUpdateRelease(releaseId);
  const { data: artifactsData, isLoading: artifactsLoading } = useReleaseArtifacts(releaseId);
  const { data: observationsData, isLoading: observationsLoading } =
    useReleaseObservations(releaseId);
  const pinRelease = usePinRelease();
  const unpinRelease = useUnpinRelease();

  const artifactColumns = useMemo<ColumnDef<Artifact>[]>(
    () => [
      {
        accessorKey: "artifactType",
        meta: { label: "Type" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
            {row.original.artifactType}
          </span>
        ),
      },
      {
        accessorKey: "url",
        meta: { label: "Artifact" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Artifact" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <a
              href={row.original.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              {row.original.url}
            </a>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {row.original.sizeBytes ? (
                <span>{(row.original.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
              ) : null}
              {row.original.architecture ? <span>{row.original.architecture}</span> : null}
              {row.original.isPrimary ? <span>Primary</span> : null}
            </div>
          </div>
        ),
      },
      {
        id: "actions",
        meta: { label: "Actions" },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button asChild variant="ghost" size="sm">
            <a href={row.original.url} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          </Button>
        ),
      },
    ],
    [],
  );

  const observationColumns = useMemo<ColumnDef<ReleaseObservation>[]>(
    () => [
      {
        accessorKey: "observedVersionRaw",
        meta: { label: "Version" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Version" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-sm">{row.original.observedVersionRaw ?? "--"}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.observedBuildNumber
                ? `Build ${row.original.observedBuildNumber}`
                : "--"}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "observedChannel",
        meta: { label: "Channel" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Channel" />,
        cell: ({ row }) =>
          row.original.observedChannel ? (
            <StatusBadge status={row.original.observedChannel} />
          ) : (
            "--"
          ),
      },
      {
        accessorKey: "observedPublishedAt",
        meta: { label: "Published" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Published" />,
        cell: ({ row }) => <TimeAgo date={row.original.observedPublishedAt} />,
      },
      {
        accessorKey: "confidence",
        meta: { label: "Confidence" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Confidence" />,
        cell: ({ row }) => (row.original.confidence != null ? `${row.original.confidence}%` : "--"),
      },
      {
        accessorKey: "observedDownloadUrl",
        meta: { label: "Download" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Download" />,
        cell: ({ row }) =>
          row.original.observedDownloadUrl ? (
            <a
              href={row.original.observedDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block max-w-64 truncate text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              {row.original.observedDownloadUrl}
            </a>
          ) : (
            "--"
          ),
      },
      {
        accessorKey: "observedReleaseNotesUrl",
        meta: { label: "Notes" },
        enableSorting: false,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Notes" />,
        cell: ({ row }) =>
          row.original.observedReleaseNotesUrl ? (
            <a
              href={row.original.observedReleaseNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              Release Notes <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            "--"
          ),
      },
      {
        accessorKey: "createdAt",
        meta: { label: "Observed" },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Observed" />,
        cell: ({ row }) => <TimeAgo date={row.original.createdAt} />,
      },
    ],
    [],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-64" />
      </div>
    );
  }

  if (!release) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyDescription>Release not found.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div>
      <Link
        to="/releases"
        search={{ page: 1, pageSize: 50, channel: "all", status: "all" }}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Releases
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-mono text-xl font-semibold tracking-tight">{release.versionRaw}</h2>
            <StatusBadge status={release.channel} />
            <StatusBadge status={release.status} />
            {release.isPrerelease ? <StatusBadge status="beta" /> : null}
            {release.isLatestForChannel ? <StatusBadge status="latest" /> : null}
            {release.isPinnedLatest ? <StatusBadge status="pinned" /> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <IdDisplay id={release.id} />
            {release.buildNumber ? <span>Build {release.buildNumber}</span> : null}
          </div>
          {release.app ? (
            <div className="mt-3">
              <AppEntityLink app={release.app} showId />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {release.isPinnedLatest ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                unpinRelease.mutate(release.id, {
                  onSuccess: () => toast.success("Release unpinned"),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              Unpin
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                pinRelease.mutate(release.id, {
                  onSuccess: () => toast.success("Release pinned"),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              Pin
            </Button>
          )}
          <Select
            value={release.status}
            onValueChange={(value) =>
              updateRelease.mutate(
                { status: value as "active" | "superseded" | "draft" | "withdrawn" },
                {
                  onSuccess: () => toast.success("Status updated"),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="superseded">Superseded</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="withdrawn">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 rounded-lg border p-4">
        <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Normalized</dt>
            <dd className="mt-0.5 font-mono">{release.versionNormalized}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Released</dt>
            <dd className="mt-0.5">
              <TimeAgo date={release.releasedAt} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Confidence</dt>
            <dd className="mt-0.5">
              {release.sourceConfidence != null ? `${release.sourceConfidence}%` : "--"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="mt-0.5">
              <TimeAgo date={release.createdAt} />
            </dd>
          </div>
        </dl>
      </div>

      <ReleaseNotesSection
        releaseId={releaseId}
        releaseNotesHtml={release.releaseNotesHtml}
        releaseNotesUrl={release.releaseNotesUrl}
      />

      <div className="mt-6">
        <div className="mb-3">
          <h3 className="text-lg font-medium">Artifacts</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Verification state, trust metadata, and artifact shortcuts.
          </p>
        </div>
        <DataTable
          columns={artifactColumns}
          data={artifactsData?.items ?? []}
          isLoading={artifactsLoading}
          emptyMessage="No artifacts."
          enableColumnVisibility
        />
      </div>

      <div className="mt-6">
        <div className="mb-3">
          <h3 className="text-lg font-medium">Observations</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Parser observations with published timestamps, channels, and source links.
          </p>
        </div>
        <DataTable
          columns={observationColumns}
          data={observationsData?.items ?? []}
          isLoading={observationsLoading}
          emptyMessage="No observations."
          enableColumnVisibility
        />
      </div>
    </div>
  );
}

const NOTES_PROSE_CLASSES =
  "rounded-lg border p-4 text-sm leading-relaxed [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 dark:[&_a]:text-blue-400";

function ReleaseNotesSection({
  releaseId,
  releaseNotesHtml,
  releaseNotesUrl,
}: {
  releaseId: string;
  releaseNotesHtml: string | null;
  releaseNotesUrl: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draftHtml, setDraftHtml] = useState(releaseNotesHtml ?? "");
  const [draftUrl, setDraftUrl] = useState(releaseNotesUrl ?? "");
  const updateRelease = useUpdateRelease(releaseId);

  const handleSave = () => {
    updateRelease.mutate(
      { releaseNotesHtml: draftHtml || null, releaseNotesUrl: draftUrl || null },
      {
        onSuccess: () => {
          toast.success("Release notes updated");
          setEditing(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium">Release Notes</h3>
          {!editing && releaseNotesUrl ? (
            <a
              href={releaseNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              View external <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraftHtml(releaseNotesHtml ?? "");
                setDraftUrl(releaseNotesUrl ?? "");
                setEditing(false);
              }}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={updateRelease.isPending}>
              <Save className="h-4 w-4" />
              {updateRelease.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              Release Notes URL
            </label>
            <Input
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="https://example.com/changelog/v1.2.3"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              Release Notes HTML
            </label>
            <Textarea
              value={draftHtml}
              onChange={(e) => setDraftHtml(e.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder="<p>Release notes HTML...</p>"
            />
          </div>
        </div>
      ) : releaseNotesHtml ? (
        <div
          className={NOTES_PROSE_CLASSES}
          dangerouslySetInnerHTML={{ __html: releaseNotesHtml }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No release notes.</p>
      )}
    </div>
  );
}
