import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Activity,
  ArrowRight,
  Box,
  Package,
  Radio,
  Radar,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { useAuditLog } from "@/api/hooks/use-audit-log";
import { useCatalogSuggestions } from "@/api/hooks/use-review";
import { useStats } from "@/api/hooks/use-stats";
import { AppIcon } from "@/components/shared/app-icon";
import { EntityReferenceLink } from "@/components/shared/entity-link";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: stats, isLoading } = useStats();
  const { data: recentActivity } = useAuditLog({ limit: 10 });
  const { data: suggestions, isLoading: suggestionsLoading } = useCatalogSuggestions({
    status: "pending",
    limit: 5,
  });

  const pendingSuggestions = suggestions?.items ?? [];

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-1 text-muted-foreground">
        Operational overview and pending catalog review work.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Catalog Apps"
          value={stats?.totalApps}
          icon={Box}
          href="/apps"
          isLoading={isLoading}
        />
        <StatCard
          title="Active Sources"
          value={stats?.activeSources}
          icon={Radio}
          href="/sources"
          isLoading={isLoading}
          accent="emerald"
        />
        <StatCard
          title="Catalog Inbox"
          value={stats?.pendingCatalogSuggestions}
          icon={Workflow}
          href="/review"
          isLoading={isLoading}
          accent={stats?.pendingCatalogSuggestions ? "amber" : undefined}
        />
        <StatCard
          title="Error Sources"
          value={stats?.errorSources}
          icon={AlertTriangle}
          href="/sources"
          search={{ status: "error" }}
          isLoading={isLoading}
          accent={stats?.errorSources ? "red" : undefined}
        />
        <StatCard
          title="Open Failures"
          value={stats?.openFailures}
          icon={Package}
          href="/job-failures"
          isLoading={isLoading}
          accent={stats?.openFailures ? "red" : undefined}
        />
        <StatCard
          title="Pending Discoveries"
          value={stats?.pendingDiscoveredApps}
          icon={Radar}
          href="/discovered-apps"
          isLoading={isLoading}
          accent={stats?.pendingDiscoveredApps ? "amber" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Public Apps"
          value={stats?.publicApps}
          icon={ShieldCheck}
          href="/apps"
          isLoading={isLoading}
          accent="emerald"
        />
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-medium">
            <Workflow className="h-5 w-5" />
            Catalog Review
          </h3>
          <Link
            to="/review"
            search={{ page: 1, pageSize: 25, status: "pending", queueType: "all" }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Next pending catalog suggestions.</p>
        <div className="mt-3 rounded-lg border">
          {suggestionsLoading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : pendingSuggestions.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No pending suggestions.</p>
          ) : (
            pendingSuggestions.map((item) => {
              const app = item.app ?? item.source?.app;
              return (
                <Link
                  key={item.id}
                  to="/review"
                  search={{ page: 1, pageSize: 25, status: "pending", queueType: "all" }}
                  className="flex w-full items-start justify-between gap-4 border-b px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={item.queueType} className="capitalize" />
                      <Badge variant="outline">{item.evidenceCount} evidence</Badge>
                    </div>
                    <div className="mt-2 font-medium">{item.title}</div>
                    <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                      <AppIcon
                        iconR2Key={app?.iconR2Key ?? null}
                        appName={app?.canonicalName ?? item.title}
                        size={24}
                      />
                      <span className="truncate">
                        {app?.canonicalName ?? "Unlinked suggestion"}
                      </span>
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
            })
          )}
        </div>
      </div>

      <div className="mt-8">
        <h3 className="flex items-center gap-2 text-lg font-medium">
          <Activity className="h-5 w-5" />
          Recent Activity
        </h3>
        <div className="mt-3 rounded-lg border">
          {recentActivity?.items.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">No recent activity.</p>
          )}
          {recentActivity?.items.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between border-b last:border-b-0 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium">
                  {entry.eventType}
                </span>
                {entry.targetRef ? (
                  <EntityReferenceLink refItem={entry.targetRef} />
                ) : entry.targetType ? (
                  <span className="text-sm text-muted-foreground">
                    {entry.targetType}
                    {entry.targetId ? `: ${entry.targetId}` : ""}
                  </span>
                ) : null}
              </div>
              <TimeAgo date={entry.createdAt} className="text-sm text-muted-foreground" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  href,
  search,
  isLoading,
  accent,
}: {
  title: string;
  value: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  search?: Record<string, string>;
  isLoading?: boolean;
  accent?: "emerald" | "red" | "amber";
}) {
  const accentClass =
    accent === "red"
      ? "text-red-600 dark:text-red-400"
      : accent === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : accent === "emerald"
          ? "text-emerald-600 dark:text-emerald-400"
          : "";

  const borderAccent =
    accent === "red"
      ? "border-l-red-500"
      : accent === "amber"
        ? "border-l-amber-500"
        : accent === "emerald"
          ? "border-l-emerald-500"
          : "border-l-transparent";

  return (
    <Link
      to={href}
      search={search}
      className={cn(
        "rounded-lg border border-l-2 bg-card p-5 transition-all duration-200 hover:bg-accent/50 hover:shadow-sm hover:-translate-y-0.5",
        borderAccent,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      {isLoading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <p className={`mt-2 text-3xl font-bold tabular-nums ${accentClass}`}>{value ?? 0}</p>
      )}
    </Link>
  );
}
