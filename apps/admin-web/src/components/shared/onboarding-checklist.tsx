import { CheckCircle, Circle } from "lucide-react";

import type { OnboardingChecklist as ChecklistType } from "@/api/types";
import { cn } from "@/lib/utils";

const checklistItems: { key: keyof ChecklistType; label: string }[] = [
  { key: "hasCanonicalRecord", label: "Canonical app record created" },
  { key: "hasAliases", label: "Aliases configured" },
  { key: "hasSource", label: "Source registered" },
  { key: "parserOutputVerified", label: "Parser output verified" },
  { key: "latestReleasePublished", label: "Latest release published" },
  { key: "reviewQueueClear", label: "Review queue clear" },
  { key: "qualityScoreAcceptable", label: "Quality score acceptable" },
];

export function OnboardingChecklistCard({
  checklist,
  onToggle,
}: {
  checklist: ChecklistType;
  onToggle?: (key: string, value: boolean) => void;
}) {
  const completed = checklistItems.filter((item) => checklist[item.key] as boolean).length;
  const total = checklistItems.length;
  const pct = Math.round((completed / total) * 100);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Onboarding Checklist</h4>
        <span
          className={cn(
            "text-xs font-medium",
            pct === 100 ? "text-emerald-600" : "text-muted-foreground",
          )}
        >
          {completed}/{total} ({pct}%)
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {checklistItems.map((item) => {
          const done = checklist[item.key] as boolean;
          return (
            <li key={item.key} className="flex items-center gap-2">
              <button
                type="button"
                className="shrink-0"
                onClick={() => onToggle?.(item.key, !done)}
                disabled={!onToggle}
              >
                {done ? (
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Circle className="h-4 w-4 text-zinc-300" />
                )}
              </button>
              <span className={cn("text-sm", done ? "text-foreground" : "text-muted-foreground")}>
                {item.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
