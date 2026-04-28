import { AlertTriangle, Package, Radio, Sparkles, type LucideIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared/status-badge";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useJobFailures } from "@/hooks/use-job-failures";
import {
  useCronJobRuns,
  useTriggerCaskSync,
  useTriggerEnrichDiscoveries,
  useTriggerPollSources,
} from "@/hooks/use-jobs";

export interface CronJobRun {
  id: string;
  jobType: "poll_sources" | "cask_index_sync" | "enrich_discovered_apps";
  trigger: "manual" | "scheduled";
  status: "running" | "completed" | "failed";
  actorId: string | null;
  itemsQueued: number | null;
  itemsTotal: number | null;
  resultJson: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export const jobTypeLabels: Record<CronJobRun["jobType"], string> = {
  poll_sources: "Poll Sources",
  cask_index_sync: "Cask Index Sync",
  enrich_discovered_apps: "Enrich Discoveries",
};

export function ManualOperations() {
  const [forcePolling, setForcePolling] = useState(false);
  const pollSources = useTriggerPollSources();
  const caskSync = useTriggerCaskSync();
  const enrichDiscoveries = useTriggerEnrichDiscoveries();
  const recentRuns = useCronJobRuns({ limit: 12 });
  const openFailures = useJobFailures({ status: "open", jobType: "operational", limit: 5 });

  const latestRuns = recentRuns.data?.items ?? [];
  const latestFor = (jobType: CronJobRun["jobType"]) =>
    latestRuns.find((run) => run.jobType === jobType) as CronJobRun | undefined;

  const handlePollSources = useCallback(() => {
    pollSources.mutate(
      { force: forcePolling },
      {
        onSuccess: (result) => {
          const message =
            result.status === "failed"
              ? `Queued ${result.itemsQueued} of ${result.itemsTotal} sources; ${result.failedCount} failed`
              : `Queued ${result.itemsQueued} of ${result.itemsTotal} sources`;
          (result.status === "failed" ? toast.warning : toast.success)(message);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }, [forcePolling, pollSources]);

  const handleCaskSync = useCallback(() => {
    caskSync.mutate(undefined, {
      onSuccess: () => toast.success("Cask index sync completed"),
      onError: (err) => toast.error(err.message),
    });
  }, [caskSync]);

  const handleEnrichDiscoveries = useCallback(() => {
    enrichDiscoveries.mutate(undefined, {
      onSuccess: () => toast.success("Discovery enrichment drain started"),
      onError: (err) => toast.error(err.message),
    });
  }, [enrichDiscoveries]);

  return (
    <section className="rounded-2xl border bg-muted/20 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Manual Operations</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            These actions match real backend jobs and write to run history.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          {openFailures.data?.total ?? 0} open failures
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <OperationCard
          title="Poll Sources"
          description="Queue fetch workflows for active sources that are due, or force all active sources."
          icon={Radio}
          latestRun={latestFor("poll_sources")}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={handlePollSources} disabled={pollSources.isPending}>
                {pollSources.isPending ? <Spinner /> : <Radio />}
                Poll Sources
              </Button>
              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="force-poll"
                  checked={forcePolling}
                  onCheckedChange={(checked) => setForcePolling(checked === true)}
                />
                <Label htmlFor="force-poll" className="text-xs text-muted-foreground">
                  Force all
                </Label>
              </div>
            </div>
          }
        />
        <OperationCard
          title="Cask Index Sync"
          description="Refresh the Homebrew Cask index cache and resolve cask metadata."
          icon={Package}
          latestRun={latestFor("cask_index_sync")}
          action={
            <Button size="sm" onClick={handleCaskSync} disabled={caskSync.isPending}>
              {caskSync.isPending ? <Spinner /> : <Package />}
              Sync Casks
            </Button>
          }
        />
        <OperationCard
          title="Enrich Discoveries"
          description="Start a background workflow that drains eligible discovered-app enrichment work."
          icon={Sparkles}
          latestRun={latestFor("enrich_discovered_apps")}
          action={
            <Button
              size="sm"
              onClick={handleEnrichDiscoveries}
              disabled={enrichDiscoveries.isPending}
            >
              {enrichDiscoveries.isPending ? <Spinner /> : <Sparkles />}
              Drain Backlog
            </Button>
          }
        />
      </div>
    </section>
  );
}

function OperationCard({
  title,
  description,
  icon: Icon,
  latestRun,
  action,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  latestRun?: CronJobRun;
  action: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col justify-between rounded-xl border bg-background p-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
          {latestRun ? (
            <StatusBadge status={latestRun.status} />
          ) : (
            <Badge variant="outline">No runs</Badge>
          )}
        </div>
        <h4 className="mt-4 font-medium">{title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        <div className="mt-3 text-xs text-muted-foreground">
          {latestRun ? (
            <span>
              Last {latestRun.trigger} run <TimeAgo date={latestRun.startedAt} />
            </span>
          ) : (
            "No recent run recorded."
          )}
        </div>
      </div>
      <div className="mt-4">{action}</div>
    </div>
  );
}
