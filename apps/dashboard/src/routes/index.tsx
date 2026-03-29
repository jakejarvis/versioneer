import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Box,
  MessageSquare,
  Package,
  Radar,
  Radio,
  Timer,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { useHomepage } from "@/api/hooks/use-homepage";
import type {
  AtRiskSourceItem,
  CatalogSuggestion,
  DashboardHomepageData,
  FeedbackListItem,
  HomepageDiscoveryItem,
  HomepageRunItem,
  JobFailureListItem,
  ReleaseListItem,
} from "@/api/types";
import { AppIcon } from "@/components/shared/app-icon";
import { EmptyState } from "@/components/shared/empty-state";
import { ReleaseEntityLink } from "@/components/shared/entity-link";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const reviewSearch = { page: 1, pageSize: 25, status: "pending", queueType: "all" } as const;
const appsSearch = { page: 1, pageSize: 25, search: "", status: "all" } as const;
const discoveredSearch = {
  page: 1,
  pageSize: 25,
  status: "pending",
  sortBy: "confidenceScore",
  sortDir: "desc",
} as const;
const feedbackSearch = { page: 1, pageSize: 25, status: "new", type: "all" } as const;
const failureSearch = {
  page: 1,
  pageSize: 25,
  tab: "failures",
  failureStatus: "open",
  jobType: "all",
} as const;
const atRiskSourceSearch = { page: 1, pageSize: 25, status: "at_risk", type: "all" } as const;
const jobsSearch = {
  page: 1,
  pageSize: 25,
  tab: "runs",
  jobType: "all",
  failureStatus: "open",
} as const;
const releasesSearch = {
  page: 1,
  pageSize: 25,
  channel: "all",
  status: "active",
  sortBy: "createdAt",
  sortDir: "desc",
} as const;

const EMPTY_HOMEPAGE_DATA: DashboardHomepageData = {
  overview: {
    needsAttention: {
      pendingCatalogSuggestions: 0,
      pendingDiscoveredApps: 0,
      pendingFeedback: 0,
      openFailures: 0,
    },
    sourceHealth: {
      activeSources: 0,
      errorSources: 0,
      staleSources: 0,
    },
    catalogContext: {
      publicApps: 0,
      totalApps: 0,
      recentReleases: 0,
    },
  },
  pendingSuggestions: [],
  pendingDiscoveries: [],
  newFeedback: [],
  openFailures: [],
  atRiskSources: [],
  recentRuns: [],
  recentReleases: [],
};

const jobTypeLabels: Record<HomepageRunItem["jobType"], string> = {
  poll_sources: "Poll Sources",
  cask_index_sync: "Cask Index Sync",
};

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data, isLoading } = useHomepage();
  const homepage = data ?? EMPTY_HOMEPAGE_DATA;

  const attentionTotal =
    homepage.overview.needsAttention.pendingCatalogSuggestions +
    homepage.overview.needsAttention.pendingDiscoveredApps +
    homepage.overview.needsAttention.pendingFeedback +
    homepage.overview.needsAttention.openFailures;
  const sourceAttentionTotal =
    homepage.overview.sourceHealth.errorSources + homepage.overview.sourceHealth.staleSources;

  return (
    <div>
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Operator Inbox
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The homepage answers two questions quickly: what needs attention now, and whether the
          ingestion pipeline is drifting out of bounds.
        </p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <OverviewCard
          title="Needs Attention"
          description="Open queues across review, discovery, feedback, and failures."
          icon={Workflow}
          value={attentionTotal}
          valueLabel="items waiting"
          tone="amber"
          isLoading={isLoading}
        >
          <Link
            to="/review"
            search={reviewSearch}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Catalog review" tone="amber" />
            <MetricValue value={homepage.overview.needsAttention.pendingCatalogSuggestions} />
          </Link>
          <Link
            to="/discovered-apps"
            search={discoveredSearch}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Discoveries" tone="amber" />
            <MetricValue value={homepage.overview.needsAttention.pendingDiscoveredApps} />
          </Link>
          <Link
            to="/feedback"
            search={feedbackSearch}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="New feedback" tone="blue" />
            <MetricValue value={homepage.overview.needsAttention.pendingFeedback} />
          </Link>
          <Link
            to="/jobs"
            search={failureSearch}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Open failures" tone="red" />
            <MetricValue value={homepage.overview.needsAttention.openFailures} />
          </Link>
        </OverviewCard>

        <OverviewCard
          title="Source Health"
          description="Source coverage is only useful when feeds are current and error-free."
          icon={Radio}
          value={sourceAttentionTotal}
          valueLabel="sources need follow-up"
          tone={sourceAttentionTotal > 0 ? "red" : "emerald"}
          isLoading={isLoading}
        >
          <Link
            to="/sources"
            search={{ page: 1, pageSize: 25, status: "active", type: "all" }}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Active sources" tone="emerald" />
            <MetricValue value={homepage.overview.sourceHealth.activeSources} />
          </Link>
          <Link
            to="/sources"
            search={{ page: 1, pageSize: 25, status: "error", type: "all" }}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Error sources" tone="red" />
            <MetricValue value={homepage.overview.sourceHealth.errorSources} />
          </Link>
          <Link
            to="/sources"
            search={atRiskSourceSearch}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Overdue sources" tone="amber" />
            <MetricValue value={homepage.overview.sourceHealth.staleSources} />
          </Link>
        </OverviewCard>

        <OverviewCard
          title="Catalog Context"
          description="Supporting context for what the operators are maintaining."
          icon={Box}
          value={homepage.overview.catalogContext.recentReleases}
          valueLabel="releases ingested in 7d"
          tone="blue"
          isLoading={isLoading}
        >
          <Link
            to="/apps"
            search={appsSearch}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Public apps" tone="emerald" />
            <MetricValue value={homepage.overview.catalogContext.publicApps} />
          </Link>
          <Link
            to="/apps"
            search={appsSearch}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Catalog apps" tone="slate" />
            <MetricValue value={homepage.overview.catalogContext.totalApps} />
          </Link>
          <Link
            to="/releases"
            search={releasesSearch}
            className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-background/80"
          >
            <MetricLabel label="Recent releases" tone="blue" />
            <MetricValue value={homepage.overview.catalogContext.recentReleases} />
          </Link>
        </OverviewCard>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <div className="space-y-4">
          <SectionCard
            title="Catalog Review"
            description="Oldest pending catalog suggestions first."
            icon={Workflow}
            action={
              <Link to="/review" search={reviewSearch} className={viewAllClassName}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {isLoading ? (
              <ListSkeleton rows={3} />
            ) : homepage.pendingSuggestions.length === 0 ? (
              <EmptyState message="No pending suggestions." className="border-0 py-8" />
            ) : (
              <div className="divide-y">
                {homepage.pendingSuggestions.map((item) => (
                  <CatalogSuggestionRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="High-Confidence Discoveries"
            description="Pending discoveries ranked by confidence and sighting volume."
            icon={Radar}
            action={
              <Link to="/discovered-apps" search={discoveredSearch} className={viewAllClassName}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {isLoading ? (
              <ListSkeleton rows={3} />
            ) : homepage.pendingDiscoveries.length === 0 ? (
              <EmptyState message="No pending discoveries." className="border-0 py-8" />
            ) : (
              <div className="divide-y">
                {homepage.pendingDiscoveries.map((item) => (
                  <DiscoveryRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="New Feedback"
            description="Fresh client reports that have not been triaged yet."
            icon={MessageSquare}
            action={
              <Link to="/feedback" search={feedbackSearch} className={viewAllClassName}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {isLoading ? (
              <ListSkeleton rows={3} />
            ) : homepage.newFeedback.length === 0 ? (
              <EmptyState message="No new feedback." className="border-0 py-8" />
            ) : (
              <div className="divide-y">
                {homepage.newFeedback.map((item) => (
                  <FeedbackRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard
            title="At-Risk Sources"
            description="Erroring sources and feeds that have missed their fetch interval."
            icon={AlertTriangle}
            action={
              <Link to="/sources" search={atRiskSourceSearch} className={viewAllClassName}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {isLoading ? (
              <ListSkeleton rows={4} />
            ) : homepage.atRiskSources.length === 0 ? (
              <EmptyState message="No at-risk sources." className="border-0 py-8" />
            ) : (
              <div className="divide-y">
                {homepage.atRiskSources.map((item) => (
                  <AtRiskSourceRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Open Job Failures"
            description="Newest unresolved job failures with related entities."
            icon={Package}
            action={
              <Link to="/jobs" search={failureSearch} className={viewAllClassName}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {isLoading ? (
              <ListSkeleton rows={3} />
            ) : homepage.openFailures.length === 0 ? (
              <EmptyState message="No open job failures." className="border-0 py-8" />
            ) : (
              <div className="divide-y">
                {homepage.openFailures.map((item) => (
                  <JobFailureRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Recent Job Runs"
            description="Latest poll and sync executions, including failures."
            icon={Timer}
            action={
              <Link to="/jobs" search={jobsSearch} className={viewAllClassName}>
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {isLoading ? (
              <ListSkeleton rows={3} />
            ) : homepage.recentRuns.length === 0 ? (
              <EmptyState message="No recent runs." className="border-0 py-8" />
            ) : (
              <div className="divide-y">
                {homepage.recentRuns.map((item) => (
                  <RunRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="mt-4">
        <SectionCard
          title="Recent Releases"
          description="Most recently ingested active releases across the catalog."
          icon={Package}
          action={
            <Link to="/releases" search={releasesSearch} className={viewAllClassName}>
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {isLoading ? (
            <ListSkeleton rows={4} />
          ) : homepage.recentReleases.length === 0 ? (
            <EmptyState message="No active releases yet." className="border-0 py-8" />
          ) : (
            <div className="divide-y">
              {homepage.recentReleases.map((item) => (
                <ReleaseRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function OverviewCard({
  title,
  description,
  icon: Icon,
  value,
  valueLabel,
  tone,
  isLoading,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  value: number;
  valueLabel: string;
  tone: "amber" | "blue" | "emerald" | "red";
  isLoading?: boolean;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden border shadow-sm",
        tone === "amber" && "border-amber-500/30 bg-linear-to-br from-amber-500/8 via-card to-card",
        tone === "blue" && "border-sky-500/30 bg-linear-to-br from-sky-500/8 via-card to-card",
        tone === "emerald" &&
          "border-emerald-500/30 bg-linear-to-br from-emerald-500/8 via-card to-card",
        tone === "red" && "border-red-500/30 bg-linear-to-br from-red-500/8 via-card to-card",
      )}
    >
      <CardHeader className="border-b pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {title}
            </p>
            <CardDescription className="mt-2 max-w-xs text-sm leading-6">
              {description}
            </CardDescription>
          </div>
          <div
            className={cn(
              "rounded-full border p-2.5",
              tone === "amber" && "border-amber-500/30 bg-amber-500/10 text-amber-700",
              tone === "blue" && "border-sky-500/30 bg-sky-500/10 text-sky-700",
              tone === "emerald" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
              tone === "red" && "border-red-500/30 bg-red-500/10 text-red-700",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {isLoading ? (
          <>
            <Skeleton className="h-10 w-32" />
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <div className="text-3xl font-semibold tabular-nums">{value}</div>
              <div className="text-sm text-muted-foreground">{valueLabel}</div>
            </div>
            <div className="space-y-1.5">{children}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            <span>{title}</span>
          </div>
          <CardTitle className="text-lg font-semibold tracking-tight">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="px-0">{children}</CardContent>
    </Card>
  );
}

function CatalogSuggestionRow({ item }: { item: CatalogSuggestion }) {
  const app = item.app ?? item.source?.app;

  return (
    <Link
      to="/review"
      search={reviewSearch}
      className="flex items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.queueType} className="capitalize" />
          <Badge variant="outline">{item.evidenceCount} evidence</Badge>
        </div>
        <div className="mt-2 truncate font-medium">{item.title}</div>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <AppIcon
            iconR2Key={app?.iconR2Key ?? null}
            appName={app?.canonicalName ?? item.title}
            size={24}
          />
          <span className="truncate">{app?.canonicalName ?? "Unlinked suggestion"}</span>
          {item.source ? (
            <span className="truncate text-xs">
              source: {item.source.label ?? item.source.sourceType}
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <div>
          first seen <TimeAgo date={item.firstSeenAt} />
        </div>
        <div className="mt-1">
          last seen <TimeAgo date={item.lastSeenAt} />
        </div>
      </div>
    </Link>
  );
}

function DiscoveryRow({ item }: { item: HomepageDiscoveryItem }) {
  const version = item.enrichedLatestVersion ?? item.homebrewCaskVersion;

  return (
    <Link
      to="/discovered-apps"
      search={discoveredSearch}
      className="flex items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
    >
      <div className="min-w-0 flex items-start gap-3">
        <AppIcon iconR2Key={item.iconR2Key} appName={item.appName} size={28} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate font-medium">{item.appName}</div>
            <ConfidenceBadge score={item.confidenceScore} />
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {item.bundleId ?? "No bundle identifier"}{" "}
            {item.enrichedVendorName ? `· ${item.enrichedVendorName}` : ""}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{item.sightingCount} sightings</Badge>
            {item.sourceValidationStatus === "valid" ? (
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-700">
                feed ok
              </Badge>
            ) : null}
            {item.homebrewCaskToken ? (
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-700">
                brew: {item.homebrewCaskToken}
              </Badge>
            ) : null}
            {version ? <Badge variant="outline">latest {version}</Badge> : null}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <div>
          last seen <TimeAgo date={item.lastSeenAt} />
        </div>
      </div>
    </Link>
  );
}

function FeedbackRow({ item }: { item: FeedbackListItem }) {
  return (
    <Link
      to="/feedback"
      search={feedbackSearch}
      className="flex items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {item.feedbackType.replaceAll("_", " ")}
          </Badge>
          <StatusBadge status={item.status} />
        </div>
        <div className="mt-2">
          {item.targetApp ? (
            <div className="flex items-start gap-3">
              <AppIcon
                iconR2Key={item.targetApp.iconR2Key}
                appName={item.targetApp.canonicalName}
                size={28}
              />
              <div className="min-w-0">
                <div className="truncate font-medium">{item.targetApp.canonicalName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.targetApp.vendorName ?? item.targetApp.slug}
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="truncate font-medium">{item.appName ?? "Unknown app"}</div>
              <div className="truncate text-xs text-muted-foreground">
                {item.bundleId ?? "No bundle identifier"}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <TimeAgo date={item.createdAt} />
      </div>
    </Link>
  );
}

function AtRiskSourceRow({ item }: { item: AtRiskSourceItem }) {
  return (
    <Link
      to="/sources/$sourceId"
      params={{ sourceId: item.id }}
      className="flex items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {item.risk === "error" ? (
            <StatusBadge status="error" />
          ) : (
            <Badge variant="outline" className="border-amber-500/30 text-amber-700">
              overdue
            </Badge>
          )}
          <StatusBadge status={item.status} />
        </div>
        <div className="mt-2 min-w-0">
          <div className="truncate font-medium">{item.label ?? item.sourceType}</div>
          <div className="truncate text-xs text-muted-foreground">
            {item.app?.canonicalName ?? "Unlinked source"} · {item.parserKey} · {item.sourceType}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{item.pollIntervalMinutes}m interval</span>
          <span>·</span>
          <span>
            {item.lastFetchedAt ? (
              <>
                last fetched <TimeAgo date={item.lastFetchedAt} />
              </>
            ) : (
              "never fetched"
            )}
          </span>
          {item.lastSuccessAt ? (
            <>
              <span>·</span>
              <span>
                last success <TimeAgo date={item.lastSuccessAt} />
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        {item.risk === "error" ? (
          <div>
            failed {item.lastFailureAt ? <TimeAgo date={item.lastFailureAt} /> : "recently"}
          </div>
        ) : (
          <div>{formatOverdue(item.overdueMinutes)} overdue</div>
        )}
      </div>
    </Link>
  );
}

function JobFailureRow({ item }: { item: JobFailureListItem }) {
  return (
    <Link
      to="/jobs"
      search={failureSearch}
      className="flex items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{item.jobType}</Badge>
          <StatusBadge status={item.status} />
        </div>
        {item.relatedRef ? (
          <div className="mt-2 min-w-0">
            <div className="truncate text-sm font-medium">{item.relatedRef.label}</div>
            {item.relatedRef.description ? (
              <div className="truncate text-xs text-muted-foreground">
                {item.relatedRef.description}
              </div>
            ) : null}
          </div>
        ) : null}
        {item.errorMessage ? (
          <div className="mt-2 line-clamp-2 text-xs text-red-600 dark:text-red-400">
            {item.errorMessage}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <TimeAgo date={item.createdAt} />
      </div>
    </Link>
  );
}

function RunRow({ item }: { item: HomepageRunItem }) {
  return (
    <Link
      to="/jobs"
      search={jobsSearch}
      className="flex items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} />
          <Badge variant="outline">{jobTypeLabels[item.jobType]}</Badge>
          <Badge variant="outline" className="capitalize">
            {item.trigger}
          </Badge>
        </div>
        <div className="mt-2 text-sm">
          {item.itemsQueued == null ? (
            <span className="text-muted-foreground">No item count recorded.</span>
          ) : item.itemsTotal != null ? (
            <span>
              Queued <span className="font-medium">{item.itemsQueued}</span> of{" "}
              <span className="font-medium">{item.itemsTotal}</span>
            </span>
          ) : (
            <span>
              Queued <span className="font-medium">{item.itemsQueued}</span>
            </span>
          )}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          duration {formatRunDuration(item.startedAt, item.completedAt)}
          {item.actorId ? ` · ${item.actorId}` : " · system"}
        </div>
        {item.errorMessage ? (
          <div className="mt-2 line-clamp-2 text-xs text-red-600 dark:text-red-400">
            {item.errorMessage}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <TimeAgo date={item.startedAt} />
      </div>
    </Link>
  );
}

function ReleaseRow({ item }: { item: ReleaseListItem }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <AppIcon
            iconR2Key={item.app?.iconR2Key ?? null}
            appName={item.app?.canonicalName ?? item.versionRaw}
            size={28}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ReleaseEntityLink
                className="min-w-0"
                release={{
                  id: item.id,
                  versionRaw: item.versionRaw,
                  channel: item.channel,
                  status: item.status,
                  isPrerelease: item.isPrerelease,
                  releasedAt: item.releasedAt,
                  app: item.app,
                }}
              />
              <StatusBadge status={item.channel} />
              {item.isLatestForChannel ? <Badge variant="outline">latest</Badge> : null}
              {item.isPinnedLatest ? <Badge variant="outline">pinned</Badge> : null}
            </div>
            <div className="mt-2 truncate text-sm text-muted-foreground">
              {item.app?.canonicalName ?? "Unlinked release"}
            </div>
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <div>
          ingested <TimeAgo date={item.createdAt} />
        </div>
        {item.releasedAt ? (
          <div className="mt-1">
            released <TimeAgo date={item.releasedAt} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetricLabel({
  label,
  tone,
}: {
  label: string;
  tone: "amber" | "blue" | "emerald" | "red" | "slate";
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-foreground">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          tone === "amber" && "bg-amber-500",
          tone === "blue" && "bg-sky-500",
          tone === "emerald" && "bg-emerald-500",
          tone === "red" && "bg-red-500",
          tone === "slate" && "bg-slate-500",
        )}
      />
      <span>{label}</span>
    </div>
  );
}

function MetricValue({ value }: { value: number }) {
  return <span className="text-sm font-semibold tabular-nums">{value}</span>;
}

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <Badge variant="outline">score --</Badge>;
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        score >= 70 && "border-emerald-500/30 text-emerald-700",
        score >= 40 && score < 70 && "border-amber-500/30 text-amber-700",
        score < 40 && "border-red-500/30 text-red-700",
      )}
    >
      score {score}
    </Badge>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 px-6 py-4">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-[4.5rem] w-full" />
      ))}
    </div>
  );
}

function formatOverdue(overdueMinutes: number | null) {
  if (overdueMinutes == null) {
    return "unknown";
  }

  if (overdueMinutes < 60) {
    return `${overdueMinutes}m`;
  }

  const hours = overdueMinutes / 60;
  if (hours < 24) {
    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  }

  return `${(hours / 24).toFixed(1)}d`;
}

function formatRunDuration(startedAt: string, completedAt: string | null) {
  if (!completedAt) {
    return "--";
  }

  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

const viewAllClassName =
  "inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground";
