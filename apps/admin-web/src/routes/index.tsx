import { createFileRoute, Link } from "@tanstack/react-router";
import { Box, Radio, AlertTriangle, ClipboardList, Package, Activity } from "lucide-react";

import { useAuditLog } from "@/api/hooks/use-audit-log";
import { useStats } from "@/api/hooks/use-stats";
import { TimeAgo } from "@/components/shared/time-ago";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: stats, isLoading } = useStats();
  const { data: recentActivity } = useAuditLog({ limit: 10 });

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-1 text-muted-foreground">Overview of the Versioneer system.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Total Apps"
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
          title="Error Sources"
          value={stats?.errorSources}
          icon={AlertTriangle}
          href="/sources"
          isLoading={isLoading}
          accent={stats?.errorSources ? "red" : undefined}
        />
        <StatCard
          title="Pending Reviews"
          value={stats?.pendingReviews}
          icon={ClipboardList}
          href="/review-queue"
          isLoading={isLoading}
          accent={stats?.pendingReviews ? "amber" : undefined}
        />
        <StatCard
          title="Open Failures"
          value={stats?.openFailures}
          icon={Package}
          href="/job-failures"
          isLoading={isLoading}
          accent={stats?.openFailures ? "red" : undefined}
        />
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
                {entry.targetType && (
                  <span className="text-sm text-muted-foreground">
                    {entry.targetType}
                    {entry.targetId ? `: ${entry.targetId}` : ""}
                  </span>
                )}
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
  isLoading,
  accent,
}: {
  title: string;
  value: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  isLoading?: boolean;
  accent?: "emerald" | "red" | "amber";
}) {
  const accentClass =
    accent === "red"
      ? "text-red-600"
      : accent === "amber"
        ? "text-amber-600"
        : accent === "emerald"
          ? "text-emerald-600"
          : "";

  return (
    <Link to={href} className="rounded-lg border bg-card p-5 transition-colors hover:bg-accent/50">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      {isLoading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <p className={`mt-2 text-3xl font-bold ${accentClass}`}>{value ?? 0}</p>
      )}
    </Link>
  );
}
