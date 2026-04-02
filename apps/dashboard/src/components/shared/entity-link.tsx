import { Link } from "@tanstack/react-router";

import type { AppSummary, LinkedEntityRef, ReleaseSummary, SourceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AppIcon } from "./app-icon";
import { IdDisplay } from "./id-display";

interface BaseLinkProps {
  className?: string;
  showId?: boolean;
}

export function AppEntityLink({
  app,
  className,
  showId = false,
}: BaseLinkProps & {
  app: AppSummary;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3", className)}>
      <Link
        to="/apps/$appId"
        params={{ appId: app.id }}
        className="flex min-w-0 items-start gap-3 hover:text-foreground"
      >
        <AppIcon iconR2Key={app.iconR2Key} appName={app.canonicalName} size={28} />
        <div className="min-w-0">
          <div className="truncate font-medium">{app.canonicalName}</div>
          <div className="truncate text-xs text-muted-foreground">{app.vendorName || app.slug}</div>
        </div>
      </Link>
      {showId ? <IdDisplay id={app.id} className="shrink-0" /> : null}
    </div>
  );
}

export function SourceEntityLink({
  source,
  className,
  showId = false,
}: BaseLinkProps & {
  source: SourceSummary;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <Link
          to="/sources/$sourceId"
          params={{ sourceId: source.id }}
          className="truncate font-medium hover:text-foreground"
        >
          {source.label ?? source.sourceType}
        </Link>
        {showId ? <IdDisplay id={source.id} /> : null}
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {source.parserKey} · {source.sourceType}
      </div>
    </div>
  );
}

export function ReleaseEntityLink({
  release,
  className,
  showId = false,
}: BaseLinkProps & {
  release: ReleaseSummary;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <Link
          to="/releases/$releaseId"
          params={{ releaseId: release.id }}
          className="truncate font-mono font-medium hover:text-foreground"
        >
          {release.versionRaw}
        </Link>
        {showId ? <IdDisplay id={release.id} /> : null}
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {release.channel} · {release.status}
      </div>
    </div>
  );
}

function entityHref(ref: LinkedEntityRef) {
  switch (ref.kind) {
    case "app":
      return `/apps/${ref.id}`;
    case "source":
      return `/sources/${ref.id}`;
    case "release":
      return `/releases/${ref.id}`;
    case "job_failure":
      return `/job-failures`;
    case "feedback":
      return `/feedback`;
    default:
      return null;
  }
}

export function EntityReferenceLink({
  refItem,
  className,
}: {
  refItem: LinkedEntityRef | null;
  className?: string;
}) {
  if (!refItem) {
    return <span className={cn("text-muted-foreground", className)}>--</span>;
  }

  const href = entityHref(refItem);

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {refItem.iconR2Key ? (
        <AppIcon iconR2Key={refItem.iconR2Key} appName={refItem.label} size={20} />
      ) : null}
      <div className="min-w-0">
        {href ? (
          <a href={href} className="truncate text-sm font-medium hover:underline">
            {refItem.label}
          </a>
        ) : (
          <div className="truncate text-sm font-medium">{refItem.label}</div>
        )}
        {refItem.description ? (
          <div className="truncate text-xs text-muted-foreground">{refItem.description}</div>
        ) : null}
      </div>
      <IdDisplay id={refItem.id} />
    </div>
  );
}
