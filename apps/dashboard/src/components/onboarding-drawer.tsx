import { parseGitHubRepoUrl, toGitHubApiReleasesUrl } from "@versioneer/validation";
import {
  Check,
  CircleAlert,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useDiscoveredApp } from "@/api/hooks/use-discovered-apps";
import {
  useCheckSlugAvailable,
  useOnboardDiscoveredApp,
  useValidateSource,
} from "@/api/hooks/use-onboarding";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type AliasType =
  | "bundle_id"
  | "name"
  | "team_id"
  | "sparkle_feed"
  | "homepage"
  | "download_pattern"
  | "github_repo"
  | "mas_app_id";

interface AliasEntry {
  key: string;
  aliasType: AliasType;
  value: string;
}

interface SourceConfig {
  sourceType: "sparkle" | "github_releases" | "manual";
  baseUrl: string;
  parserKey: string;
  pollIntervalMinutes: number;
  label?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.split("T")[0] ?? null;
  }
}

const ALIAS_COLORS: Record<AliasType, string> = {
  bundle_id: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  name: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  team_id: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  sparkle_feed: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  homepage: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  download_pattern: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  github_repo: "bg-neutral-500/10 text-neutral-300 border-neutral-500/20",
  mas_app_id: "bg-pink-500/10 text-pink-400 border-pink-500/20",
};

const ALIAS_LABELS: Record<AliasType, string> = {
  bundle_id: "Bundle ID",
  name: "Name",
  team_id: "Team ID",
  sparkle_feed: "Sparkle",
  homepage: "Homepage",
  download_pattern: "Download",
  github_repo: "GitHub",
  mas_app_id: "App Store",
};

interface Props {
  discoveredAppId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (appId: string) => void;
}

export function OnboardingDrawer({ discoveredAppId, open, onOpenChange, onSuccess }: Props) {
  const { data: discoveredApp, isLoading } = useDiscoveredApp(open ? discoveredAppId : null);
  const onboard = useOnboardDiscoveredApp();
  const validateSourceMutation = useValidateSource();

  const [canonicalName, setCanonicalName] = useState("");
  const [slug, setSlug] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [aliases, setAliases] = useState<AliasEntry[]>([]);
  const [source, setSource] = useState<SourceConfig | null>(null);
  const [sourceValidated, setSourceValidated] = useState(false);

  const slugCheck = useCheckSlugAvailable(slug);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset runs only when the underlying data changes
  useEffect(() => {
    if (!discoveredApp) return;

    setCanonicalName(discoveredApp.appName);
    setSlug(slugify(discoveredApp.appName));
    setVendorName(discoveredApp.enrichedVendorName ?? "");
    setHomepageUrl(discoveredApp.enrichedHomepageUrl ?? "");
    setNotes("");
    setSourceValidated(discoveredApp.sourceValidationStatus === "valid");

    const newAliases: AliasEntry[] = [];
    if (discoveredApp.bundleId) {
      newAliases.push({
        key: crypto.randomUUID(),
        aliasType: "bundle_id",
        value: discoveredApp.bundleId,
      });
    }
    newAliases.push({
      key: crypto.randomUUID(),
      aliasType: "name",
      value: discoveredApp.appName,
    });
    if (discoveredApp.teamId) {
      newAliases.push({
        key: crypto.randomUUID(),
        aliasType: "team_id",
        value: discoveredApp.teamId,
      });
    }
    if (discoveredApp.sparkleFeedUrl) {
      newAliases.push({
        key: crypto.randomUUID(),
        aliasType: "sparkle_feed",
        value: discoveredApp.sparkleFeedUrl,
      });
    }
    if (discoveredApp.electronUpdateUrl) {
      const parsed = parseGitHubRepoUrl(discoveredApp.electronUpdateUrl);
      if (parsed) {
        newAliases.push({
          key: crypto.randomUUID(),
          aliasType: "github_repo",
          value: `${parsed.owner}/${parsed.repo}`,
        });
      }
    }
    setAliases(newAliases);

    if (discoveredApp.sparkleFeedUrl) {
      setSource({
        sourceType: "sparkle",
        baseUrl: discoveredApp.sparkleFeedUrl,
        parserKey: "sparkle",
        pollIntervalMinutes: 60,
      });
    } else if (discoveredApp.electronUpdateUrl) {
      const apiUrl = toGitHubApiReleasesUrl(discoveredApp.electronUpdateUrl);
      if (apiUrl) {
        setSource({
          sourceType: "github_releases",
          baseUrl: apiUrl,
          parserKey: "github_releases",
          pollIntervalMinutes: 60,
        });
      } else {
        setSource(null);
      }
    } else {
      setSource(null);
    }
  }, [discoveredApp]);

  const confidenceScore = discoveredApp?.confidenceScore ?? 0;
  const enrichmentHasReleases = (discoveredApp?.enrichedReleaseCount ?? 0) > 0;

  const canSubmit = slug.length > 0 && canonicalName.length > 0 && slugCheck.data?.available;

  const handleTestFeed = () => {
    if (!source) return;
    validateSourceMutation.mutate({
      url: source.baseUrl,
      sourceType: source.sourceType as "sparkle" | "github_releases",
    });
  };

  const handleSubmit = () => {
    if (!discoveredAppId || !canSubmit) return;
    onboard.mutate(
      {
        discoveredAppId,
        app: {
          slug,
          canonicalName,
          vendorName: vendorName || undefined,
          homepageUrl: homepageUrl || undefined,
          notes: notes || undefined,
        },
        aliases: aliases
          .filter((a) => a.value.trim())
          .map((a) => ({ aliasType: a.aliasType, value: a.value })),
        source: source?.baseUrl ? source : undefined,
        sourceValidated: sourceValidated || validateSourceMutation.data?.status === "valid",
        enrichmentHasReleases,
      },
      {
        onSuccess: (data) => {
          onOpenChange(false);
          onSuccess?.(data.id);
        },
      },
    );
  };

  const addAlias = () =>
    setAliases([...aliases, { key: crypto.randomUUID(), aliasType: "bundle_id", value: "" }]);
  const removeAlias = (key: string) => setAliases(aliases.filter((a) => a.key !== key));
  const updateAlias = (key: string, field: "aliasType" | "value", val: string) =>
    setAliases(
      aliases.map((a) =>
        a.key === key ? { ...a, [field]: field === "aliasType" ? (val as AliasType) : val } : a,
      ),
    );

  const validAliasCount = useMemo(() => aliases.filter((a) => a.value.trim()).length, [aliases]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-lg p-0 flex flex-col gap-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-4 shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-base">Onboard New App</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                Review pre-populated data, then add to the catalog.
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 -mr-1 -mt-1"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !discoveredApp ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            App not found.
          </div>
        ) : (
          <>
            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-5 pb-5 space-y-5">
                {/* Confidence + enrichment summary */}
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3.5">
                  <div className="flex items-center gap-3">
                    <ConfidenceRing score={confidenceScore} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{discoveredApp.appName}</div>
                      {discoveredApp.bundleId && (
                        <div className="text-[11px] font-mono text-muted-foreground truncate">
                          {discoveredApp.bundleId}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {discoveredApp.sourceValidationStatus === "valid" ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        >
                          <Check className="mr-0.5 h-2.5 w-2.5" />
                          Feed valid
                        </Badge>
                      ) : discoveredApp.sourceValidationStatus === "invalid" ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-red-500/30 bg-red-500/10 text-red-400"
                        >
                          <CircleAlert className="mr-0.5 h-2.5 w-2.5" />
                          Feed invalid
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {discoveredApp.enrichedLatestVersion && (
                    <div className="mt-2.5 pt-2.5 border-t border-border/40 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>
                        Latest{" "}
                        <span className="font-mono font-medium text-foreground">
                          {discoveredApp.enrichedLatestVersion}
                        </span>
                      </span>
                      {discoveredApp.enrichedLatestPublishedAt && (
                        <>
                          <span className="text-border">|</span>
                          <span>{formatDate(discoveredApp.enrichedLatestPublishedAt)}</span>
                        </>
                      )}
                      {discoveredApp.enrichedReleaseCount != null && (
                        <>
                          <span className="text-border">|</span>
                          <span>{discoveredApp.enrichedReleaseCount} releases</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* App Identity */}
                <section>
                  <SectionHeader label="App Identity" />
                  <div className="mt-2.5 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      <FieldGroup label="Canonical Name">
                        <Input
                          value={canonicalName}
                          onChange={(e) => {
                            setCanonicalName(e.target.value);
                            setSlug(slugify(e.target.value));
                          }}
                          className="h-8 text-sm"
                        />
                      </FieldGroup>
                      <FieldGroup
                        label="Slug"
                        trailing={
                          slugCheck.data ? (
                            <span
                              className={`text-[10px] font-medium ${slugCheck.data.available ? "text-emerald-400" : "text-red-400"}`}
                            >
                              {slugCheck.data.available ? "available" : "taken"}
                            </span>
                          ) : null
                        }
                      >
                        <Input
                          value={slug}
                          onChange={(e) => setSlug(e.target.value)}
                          className="h-8 text-sm font-mono"
                        />
                      </FieldGroup>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <FieldGroup label="Vendor">
                        <Input
                          value={vendorName}
                          onChange={(e) => setVendorName(e.target.value)}
                          placeholder="Auto-detected or manual"
                          className="h-8 text-sm"
                        />
                      </FieldGroup>
                      <FieldGroup label="Homepage">
                        <div className="relative">
                          <Input
                            value={homepageUrl}
                            onChange={(e) => setHomepageUrl(e.target.value)}
                            placeholder="https://..."
                            className="h-8 text-sm pr-7"
                          />
                          {homepageUrl && (
                            <a
                              href={homepageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </FieldGroup>
                    </div>
                    <FieldGroup label="Notes">
                      <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Optional notes..."
                        rows={2}
                        className="text-sm resize-none"
                      />
                    </FieldGroup>
                  </div>
                </section>

                <Separator className="opacity-40" />

                {/* Aliases */}
                <section>
                  <div className="flex items-center justify-between">
                    <SectionHeader label={`Aliases (${validAliasCount})`} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground hover:text-foreground"
                      onClick={addAlias}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add
                    </Button>
                  </div>
                  <div className="mt-2.5 space-y-1.5">
                    {aliases.map((alias) => (
                      <div
                        key={alias.key}
                        className="group flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 p-1 pl-1.5"
                      >
                        <select
                          value={alias.aliasType}
                          onChange={(e) => updateAlias(alias.key, "aliasType", e.target.value)}
                          className={`h-6 rounded border px-1.5 text-[10px] font-medium shrink-0 appearance-none cursor-pointer ${ALIAS_COLORS[alias.aliasType]}`}
                        >
                          {Object.entries(ALIAS_LABELS).map(([val, label]) => (
                            <option key={val} value={val}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <input
                          value={alias.value}
                          onChange={(e) => updateAlias(alias.key, "value", e.target.value)}
                          className="flex-1 min-w-0 bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
                          placeholder="value..."
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeAlias(alias.key)}
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </section>

                <Separator className="opacity-40" />

                {/* Source */}
                <section>
                  <SectionHeader label="Source" />
                  {source ? (
                    <div className="mt-2.5 space-y-2.5">
                      <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 p-2">
                        <Badge variant="outline" className="text-[10px] shrink-0 border-border/60">
                          {source.sourceType}
                        </Badge>
                        <span className="text-[11px] font-mono text-muted-foreground truncate flex-1 min-w-0">
                          {source.baseUrl}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => setSource(null)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={handleTestFeed}
                          disabled={validateSourceMutation.isPending}
                        >
                          {validateSourceMutation.isPending ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-1 h-3 w-3" />
                          )}
                          Test Feed
                        </Button>
                        {validateSourceMutation.data && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              validateSourceMutation.data.status === "valid"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-red-500/30 bg-red-500/10 text-red-400"
                            }`}
                          >
                            {validateSourceMutation.data.status === "valid" ? (
                              <>
                                <Check className="mr-0.5 h-2.5 w-2.5" />
                                {validateSourceMutation.data.releaseCount} releases parsed
                              </>
                            ) : (
                              validateSourceMutation.data.status
                            )}
                          </Badge>
                        )}
                      </div>
                      {validateSourceMutation.data?.releases &&
                        validateSourceMutation.data.releases.length > 0 && (
                          <div className="rounded-md border border-border/40 bg-muted/20 overflow-hidden">
                            <div className="px-2.5 py-1.5 border-b border-border/30 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                              Release Preview
                            </div>
                            <div className="divide-y divide-border/20">
                              {validateSourceMutation.data.releases.map((r) => (
                                <div
                                  key={r.version}
                                  className="flex items-center gap-2 px-2.5 py-1.5 text-xs"
                                >
                                  <span className="font-mono font-medium text-foreground">
                                    {r.version}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 border-border/40"
                                  >
                                    {r.channel}
                                  </Badge>
                                  <span className="flex-1" />
                                  {r.publishedAt && (
                                    <span className="text-[11px] text-muted-foreground tabular-nums">
                                      {formatDate(r.publishedAt)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground/70">
                      No update source detected. The app can be onboarded without one.
                    </p>
                  )}
                </section>
              </div>
            </div>

            {/* Sticky footer */}
            <SheetFooter className="border-t border-border/60 bg-background/80 backdrop-blur-sm px-5 py-3.5">
              <div className="flex items-center gap-2.5 w-full">
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || onboard.isPending}
                  size="sm"
                  className="flex-1 h-8"
                >
                  {onboard.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {onboard.isPending ? "Onboarding..." : "Onboard App"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-muted-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </h4>
  );
}

function FieldGroup({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function ConfidenceRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 16;
  const progress = (score / 100) * circumference;
  const color =
    score >= 70
      ? "text-emerald-400 stroke-emerald-400"
      : score >= 40
        ? "text-amber-400 stroke-amber-400"
        : "text-red-400 stroke-red-400";
  const trackColor =
    score >= 70
      ? "stroke-emerald-400/15"
      : score >= 40
        ? "stroke-amber-400/15"
        : "stroke-red-400/15";

  return (
    <div className="relative h-10 w-10 shrink-0">
      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="16" fill="none" strokeWidth="2.5" className={trackColor} />
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          className={color}
        />
      </svg>
      <div
        className={`absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums ${color.split(" ")[0]}`}
      >
        {score}
      </div>
    </div>
  );
}
