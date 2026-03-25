import type { DecisionExplanation, MatchExplanation } from "@/api/types";

export function MatchExplanationCard({ explanation }: { explanation: MatchExplanation }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <h5 className="font-medium">Match Explanation</h5>
      <dl className="mt-2 space-y-1">
        <Row label="Method" value={explanation.method} />
        <Row label="Confidence" value={String(explanation.confidence)} />
        {explanation.matchedAliasType && (
          <Row
            label="Matched Alias"
            value={`${explanation.matchedAliasType}: ${explanation.matchedAliasValue}`}
          />
        )}
        <Row label="Candidates" value={String(explanation.candidateCount)} />
        {explanation.ambiguous && (
          <Row label="Ambiguous" value={`Yes (gap: ${explanation.ambiguityGap})`} />
        )}
      </dl>
      {explanation.topCandidates.length > 1 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground">Top Candidates</p>
          <ul className="mt-1 space-y-0.5">
            {explanation.topCandidates.map((c) => (
              <li key={c.appId} className="text-xs text-muted-foreground">
                {c.appName} — {c.method} ({c.confidence})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function DecisionExplanationCard({ explanation }: { explanation: DecisionExplanation }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <h5 className="font-medium">Publication Decision</h5>
      <dl className="mt-2 space-y-1">
        <Row
          label="Selected"
          value={`${explanation.selectedVersion} (${explanation.selectedReleaseId})`}
        />
        <Row label="Reason" value={explanation.reason} />
        {explanation.overrideId && <Row label="Override" value={explanation.overrideId} />}
        <Row label="Candidates" value={String(explanation.candidateCount)} />
        {explanation.sourceConfidence !== null && (
          <Row label="Source Confidence" value={String(explanation.sourceConfidence)} />
        )}
      </dl>
      {explanation.alternatesRejected.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted-foreground">Rejected Alternates</p>
          <ul className="mt-1 space-y-0.5">
            {explanation.alternatesRejected.slice(0, 5).map((a) => (
              <li key={a.releaseId} className="text-xs text-muted-foreground">
                {a.version} — {a.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
