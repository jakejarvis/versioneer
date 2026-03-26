import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Box,
  Radio,
  AlertTriangle,
  ClipboardList,
  Package,
  Activity,
  ShieldCheck,
  CircleDot,
} from "lucide-react";

import { useAuditLog } from "@/api/hooks/use-audit-log";
import { useStats } from "@/api/hooks/use-stats";
import { TimeAgo } from "@/components/shared/time-ago";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: stats, isLoading } = useStats();
  const { data: recentActivity } = useAuditLog({ limit: 10 });

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
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

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Verified Apps"
          value={stats?.verifiedApps}
          icon={ShieldCheck}
          href="/apps"
          isLoading={isLoading}
          accent="emerald"
        />
        <StatCard
          title="Green Quality"
          value={stats?.greenApps}
          icon={CircleDot}
          href="/apps"
          isLoading={isLoading}
          accent="emerald"
        />
        <StatCard
          title="Yellow Quality"
          value={stats?.yellowApps}
          icon={CircleDot}
          href="/apps"
          isLoading={isLoading}
          accent="amber"
        />
        <StatCard
          title="Red Quality"
          value={stats?.redApps}
          icon={CircleDot}
          href="/apps"
          isLoading={isLoading}
          accent={stats?.redApps ? "red" : undefined}
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
