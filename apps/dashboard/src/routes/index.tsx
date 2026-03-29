import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Activity,
  Box,
  Package,
  Radio,
  Radar,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAuditLog } from "@/api/hooks/use-audit-log";
import {
  useApproveCatalogSuggestion,
  useCatalogSuggestion,
  useCatalogSuggestions,
  useRejectCatalogSuggestion,
} from "@/api/hooks/use-review";
import { useStats } from "@/api/hooks/use-stats";
import { AppIcon } from "@/components/shared/app-icon";
import { JsonViewer } from "@/components/shared/json-viewer";
import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    limit: 12,
  });
  const approveMutation = useApproveCatalogSuggestion();
  const rejectMutation = useRejectCatalogSuggestion();

  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const selectedSuggestion = useCatalogSuggestion(selectedSuggestionId ?? "");

  const pendingSuggestions = suggestions?.items ?? [];
  const selectedTitle =
    pendingSuggestions.find((item) => item.id === selectedSuggestionId)?.title ??
    "Review suggestion";

  const closeDialog = () => setSelectedSuggestionId(null);

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-1 text-muted-foreground">
        Operational overview and pending catalog review work.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          title="Catalog Inbox"
          value={stats?.pendingCatalogSuggestions}
          icon={Workflow}
          href="/"
          isLoading={isLoading}
          accent={stats?.pendingCatalogSuggestions ? "amber" : undefined}
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
          title="Open Failures"
          value={stats?.openFailures}
          icon={Package}
          href="/job-failures"
          isLoading={isLoading}
          accent={stats?.openFailures ? "red" : undefined}
        />
        <StatCard
          title="Discovered Apps"
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

      <div id="catalog-review" className="mt-8">
        <h3 className="flex items-center gap-2 text-lg font-medium">
          <Workflow className="h-5 w-5" />
          Catalog Review
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          FIFO review queue backed by deduped catalog suggestions.
        </p>
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
            pendingSuggestions.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedSuggestionId(item.id)}
                className="flex w-full items-start justify-between gap-4 border-b px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-accent/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.queueType} className="capitalize" />
                    <StatusBadge status={item.status} />
                    <Badge variant="outline">{item.evidenceCount} evidence</Badge>
                  </div>
                  <div className="mt-2 font-medium">{item.title}</div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <AppIcon
                      iconR2Key={item.app?.iconR2Key ?? null}
                      appName={
                        item.app?.canonicalName ?? item.source?.app?.canonicalName ?? item.title
                      }
                      size={24}
                    />
                    <span className="truncate">
                      {item.app?.canonicalName ??
                        item.source?.app?.canonicalName ??
                        "Unlinked suggestion"}
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
              </button>
            ))
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

      <Dialog open={!!selectedSuggestionId} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedSuggestion.data?.title ?? selectedTitle}</DialogTitle>
            <DialogDescription>
              Review the canonical snapshot, proposed change, and underlying evidence before
              applying it.
            </DialogDescription>
          </DialogHeader>

          {!selectedSuggestionId || selectedSuggestion.isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : selectedSuggestion.data ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selectedSuggestion.data.queueType} className="capitalize" />
                <StatusBadge status={selectedSuggestion.data.status} />
                <Badge variant="outline">{selectedSuggestion.data.evidenceCount} evidence</Badge>
                {selectedSuggestion.data.app ? (
                  <Badge variant="outline">app: {selectedSuggestion.data.app.canonicalName}</Badge>
                ) : null}
                {selectedSuggestion.data.source ? (
                  <Badge variant="outline">
                    source:{" "}
                    {selectedSuggestion.data.source.label ??
                      selectedSuggestion.data.source.sourceType}
                  </Badge>
                ) : null}
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Current</h4>
                  <JsonViewer
                    data={selectedSuggestion.data.canonicalSnapshotJson}
                    className="min-h-40"
                  />
                </section>
                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Proposed</h4>
                  <JsonViewer
                    data={selectedSuggestion.data.proposedChangeJson}
                    className="min-h-40"
                  />
                </section>
                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Evidence Summary</h4>
                  <JsonViewer
                    data={selectedSuggestion.data.evidenceSummaryJson}
                    className="min-h-40"
                  />
                </section>
              </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Evidence</h4>
                  <span className="text-xs text-muted-foreground">
                    first seen <TimeAgo date={selectedSuggestion.data.firstSeenAt} />
                  </span>
                </div>
                <div className="space-y-3">
                  {selectedSuggestion.data.evidence.map((entry) => (
                    <div key={entry.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusBadge status={entry.evidenceType} />
                        <span>{entry.fingerprint}</span>
                        <span>
                          observed <TimeAgo date={entry.observedAt} />
                        </span>
                      </div>
                      <JsonViewer data={entry.payloadJson} className="mt-3 max-h-56" />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">Suggestion not found.</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={
                !selectedSuggestionId || rejectMutation.isPending || approveMutation.isPending
              }
              onClick={() => {
                if (!selectedSuggestionId) return;
                rejectMutation.mutate(selectedSuggestionId, {
                  onSuccess: () => {
                    toast.success("Suggestion rejected");
                    closeDialog();
                  },
                  onError: (error) => toast.error(error.message),
                });
              }}
            >
              Reject
            </Button>
            <Button
              disabled={
                !selectedSuggestionId || rejectMutation.isPending || approveMutation.isPending
              }
              onClick={() => {
                if (!selectedSuggestionId) return;
                approveMutation.mutate(selectedSuggestionId, {
                  onSuccess: () => {
                    toast.success("Suggestion approved");
                    closeDialog();
                  },
                  onError: (error) => toast.error(error.message),
                });
              }}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
