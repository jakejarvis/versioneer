import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import {
  useRelease,
  useUpdateRelease,
  useReleaseArtifacts,
  useReleaseObservations,
} from "@/api/hooks/use-releases";
import type { Artifact, ReleaseObservation } from "@/api/types";
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
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/releases/$releaseId")({
  component: ReleaseDetailPage,
});

function ReleaseDetailPage() {
  const { releaseId } = Route.useParams();
  const { data: release, isLoading } = useRelease(releaseId);
  const updateRelease = useUpdateRelease(releaseId);
  const { data: artifactsData, isLoading: artifactsLoading } = useReleaseArtifacts(releaseId);
  const { data: obsData, isLoading: obsLoading } = useReleaseObservations(releaseId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-64" />
      </div>
    );
  }

  if (!release) {
    return <p className="text-muted-foreground">Release not found.</p>;
  }

  const artifactColumns: Column<Artifact>[] = [
    {
      key: "artifactType",
      header: "Type",
      cell: (row) => (
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{row.artifactType}</span>
      ),
    },
    {
      key: "url",
      header: "URL",
      cell: (row) => (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline truncate max-w-64 block"
        >
          {row.url}
        </a>
      ),
    },
    {
      key: "sizeBytes",
      header: "Size",
      cell: (row) => (row.sizeBytes ? `${(row.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "--"),
    },
    { key: "architecture", header: "Arch", cell: (row) => row.architecture ?? "--" },
    {
      key: "signatureStatus",
      header: "Signature",
      cell: (row) => <StatusBadge status={row.signatureStatus ?? "unknown"} />,
    },
    {
      key: "isPrimary",
      header: "Primary",
      cell: (row) => (row.isPrimary ? "Yes" : ""),
    },
  ];

  const obsColumns: Column<ReleaseObservation>[] = [
    {
      key: "parserRunId",
      header: "Parser Run",
      cell: (row) => <IdDisplay id={row.parserRunId} />,
    },
    {
      key: "observedVersionRaw",
      header: "Version",
      cell: (row) => <span className="font-mono text-sm">{row.observedVersionRaw ?? "--"}</span>,
    },
    {
      key: "confidence",
      header: "Confidence",
      cell: (row) => (row.confidence != null ? `${row.confidence}%` : "--"),
    },
    {
      key: "observedDownloadUrl",
      header: "Download",
      cell: (row) =>
        row.observedDownloadUrl ? (
          <a
            href={row.observedDownloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate max-w-48 block"
          >
            {row.observedDownloadUrl}
          </a>
        ) : (
          "--"
        ),
    },
    {
      key: "createdAt",
      header: "Observed",
      cell: (row) => <TimeAgo date={row.createdAt} />,
    },
  ];

  return (
    <div>
      <Link
        to="/releases"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Releases
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight font-mono">{release.versionRaw}</h2>
            <StatusBadge status={release.channel} />
            <StatusBadge status={release.status} />
            {release.isPrerelease && <StatusBadge status="beta" />}
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <IdDisplay id={release.id} />
            <span>
              App: <IdDisplay id={release.appId} />
            </span>
            {release.buildNumber && <span>Build: {release.buildNumber}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={release.status}
            onValueChange={(v) =>
              updateRelease.mutate(
                { status: v as "active" | "retracted" | "superseded" | "draft" },
                {
                  onSuccess: () => toast.success("Status updated"),
                  onError: (err) => toast.error(err.message),
                },
              )
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="retracted">Retracted</SelectItem>
              <SelectItem value="superseded">Superseded</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 rounded-lg border p-4">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
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

      <div className="mt-6">
        <h3 className="text-lg font-medium">Artifacts</h3>
        <div className="mt-3">
          <DataTable
            columns={artifactColumns}
            data={artifactsData?.items ?? []}
            isLoading={artifactsLoading}
            emptyMessage="No artifacts."
          />
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-lg font-medium">Observations</h3>
        <div className="mt-3">
          <DataTable
            columns={obsColumns}
            data={obsData?.items ?? []}
            isLoading={obsLoading}
            emptyMessage="No observations."
          />
        </div>
      </div>
    </div>
  );
}
