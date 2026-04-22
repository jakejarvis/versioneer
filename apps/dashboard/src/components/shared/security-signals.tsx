import { AlertTriangle, CircleCheck, CircleHelp, ExternalLink, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  artifactTrustReasons,
  getFetchFailureReasonCopy,
  getInstallTrustReasonCopy,
  getSourceAnomalyCopy,
  installStrategyLabels,
  type SecuritySignalCopy,
  type SecuritySignalTone,
} from "@/lib/security-signals";
import { cn } from "@/lib/utils";

const toneClasses: Record<SecuritySignalTone, string> = {
  ready: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  external: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  neutral: "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
};

function IconForTone({ tone }: { tone: SecuritySignalTone }) {
  if (tone === "ready") return <ShieldCheck className="h-3.5 w-3.5" />;
  if (tone === "external") return <ExternalLink className="h-3.5 w-3.5" />;
  if (tone === "neutral") return <CircleHelp className="h-3.5 w-3.5" />;
  return <AlertTriangle className="h-3.5 w-3.5" />;
}

function SecurityBadge({ copy, className }: { copy: SecuritySignalCopy; className?: string }) {
  return (
    <Badge
      variant="outline"
      title={copy.description}
      className={cn("rounded-md", toneClasses[copy.tone], className)}
    >
      <IconForTone tone={copy.tone} />
      {copy.label}
    </Badge>
  );
}

export function InstallTrustBadges({
  reasons,
  className,
  emptyLabel = "Trust ready",
}: {
  reasons: string[];
  className?: string;
  emptyLabel?: string;
}) {
  if (reasons.length === 0) {
    return (
      <Badge
        variant="outline"
        className={cn("rounded-md", toneClasses.ready, className)}
        title="One-click trust material is present for this route."
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        {emptyLabel}
      </Badge>
    );
  }

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {reasons.map((reason) => (
        <SecurityBadge key={reason} copy={getInstallTrustReasonCopy(reason)} />
      ))}
    </span>
  );
}

export function InstallTrustReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) {
    return (
      <div className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Required one-click trust material is present.</span>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {reasons.map((reason) => {
        const copy = getInstallTrustReasonCopy(reason);
        return (
          <div key={reason} className="flex items-start gap-2 text-sm">
            <IconForTone tone={copy.tone} />
            <div>
              <div className="font-medium">{copy.label}</div>
              <div className="text-muted-foreground">{copy.description}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SourceAnomalyBadge({
  jobKey,
  className,
}: {
  jobKey: string | null | undefined;
  className?: string;
}) {
  return <SecurityBadge copy={getSourceAnomalyCopy(jobKey)} className={className} />;
}

export function FetchFailureReasonBadge({
  reason,
  className,
}: {
  reason: string | null | undefined;
  className?: string;
}) {
  if (!reason) return null;
  return <SecurityBadge copy={getFetchFailureReasonCopy(reason)} className={className} />;
}

export function ArtifactTrustBadges({
  artifactType,
  sha256,
}: {
  artifactType: string;
  sha256: string | null;
}) {
  const reasons = artifactTrustReasons(artifactType, sha256);
  if (reasons.length === 0) return null;
  return <InstallTrustBadges reasons={reasons} />;
}

export function InstallStrategyBadge({
  strategy,
  reasons = [],
  className,
}: {
  strategy: string | null | undefined;
  reasons?: string[];
  className?: string;
}) {
  if (!strategy) {
    const label = reasons.includes("homebrew_external") ? "Homebrew" : "Manual route";
    return (
      <Badge variant="outline" className={cn("rounded-md", toneClasses.neutral, className)}>
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn("rounded-md", className)}>
      {installStrategyLabels[strategy] ?? strategy}
    </Badge>
  );
}
