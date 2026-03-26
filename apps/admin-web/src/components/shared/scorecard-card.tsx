import type { AppScorecard } from "@/api/types";

function MetricRow({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  const displayValue = value !== null ? `${value}${suffix ?? ""}` : "—";
  const color =
    value === null
      ? "text-zinc-400 dark:text-zinc-500"
      : value >= 90
        ? "text-emerald-600 dark:text-emerald-400"
        : value >= 70
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";

  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${color}`}>{displayValue}</span>
    </div>
  );
}

export function ScorecardCard({ scorecard }: { scorecard: AppScorecard }) {
  const sourceTypes: string[] = scorecard.sourceTypesPresent
    ? JSON.parse(scorecard.sourceTypesPresent)
    : [];

  return (
    <div className="rounded-lg border p-4">
      <h4 className="text-sm font-medium">Health Metrics</h4>
      <div className="mt-2 divide-y">
        <MetricRow label="Fetch Success Rate" value={scorecard.recentFetchSuccessRate} suffix="%" />
        <MetricRow label="Parse Success Rate" value={scorecard.recentParseSuccessRate} suffix="%" />
        <MetricRow label="Release Confidence" value={scorecard.latestReleaseConfidence} />
        <MetricRow
          label="Match Success Rate"
          value={scorecard.inventoryMatchSuccessRate}
          suffix="%"
        />
        <MetricRow label="Ambiguity Rate" value={scorecard.ambiguityRate} suffix="%" />
        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm text-muted-foreground">Active Overrides</span>
          <span className="text-sm font-medium">{scorecard.activeOverrideCount}</span>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm text-muted-foreground">Source Types</span>
          <span className="text-sm font-medium">{sourceTypes.join(", ") || "None"}</span>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-sm text-muted-foreground">Artifact Trust</span>
          <span className="text-sm font-medium">{scorecard.artifactTrustStatus ?? "Unknown"}</span>
        </div>
      </div>
    </div>
  );
}
