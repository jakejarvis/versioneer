import { parseGitHubRepoUrl, toGitHubApiReleasesUrl } from "@versioneer/validation";
import { Check, Loader2, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
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

  // Form state
  const [canonicalName, setCanonicalName] = useState("");
  const [slug, setSlug] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [aliases, setAliases] = useState<AliasEntry[]>([]);
  const [source, setSource] = useState<SourceConfig | null>(null);
  const [sourceValidated, setSourceValidated] = useState(false);

  // Slug availability
  const slugCheck = useCheckSlugAvailable(slug);

  // Reset form when a new discovered app loads
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset runs only when the underlying data changes
  useEffect(() => {
    if (!discoveredApp) return;

    setCanonicalName(discoveredApp.appName);
    setSlug(slugify(discoveredApp.appName));
    setVendorName(discoveredApp.enrichedVendorName ?? "");
    setHomepageUrl(discoveredApp.enrichedHomepageUrl ?? "");
    setNotes("");
    setSourceValidated(discoveredApp.sourceValidationStatus === "valid");

    // Build aliases from available data
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

    // Build source config
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
  const enrichmentStatus = discoveredApp?.enrichmentStatus ?? "pending";
  const enrichmentHasReleases = (discoveredApp?.enrichedReleaseCount ?? 0) > 0;

  const confidenceColor =
    confidenceScore >= 70
      ? "text-emerald-600 dark:text-emerald-400"
      : confidenceScore >= 40
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

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

  const aliasTypeLabels: Record<AliasType, string> = useMemo(
    () => ({
      bundle_id: "Bundle ID",
      name: "Name",
      team_id: "Team ID",
      sparkle_feed: "Sparkle",
      homepage: "Homepage",
      download_pattern: "Download",
      github_repo: "GitHub",
      mas_app_id: "App Store",
    }),
    [],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle>Onboard New App</SheetTitle>
          <SheetDescription>
            Review and confirm pre-populated data to add to the catalog.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !discoveredApp ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            App not found.
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-6 pb-6">
                {/* Confidence banner */}
                <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/50">
                  <div className={`text-2xl font-bold tabular-nums ${confidenceColor}`}>
                    {confidenceScore}
                  </div>
                  <div className="text-xs text-muted-foreground">confidence</div>
                  <div className="flex-1" />
                  <Badge variant={enrichmentStatus === "success" ? "default" : "secondary"}>
                    {enrichmentStatus}
                  </Badge>
                  {discoveredApp.sourceValidationStatus === "valid" && (
                    <Badge variant="default" className="bg-emerald-600">
                      <Check className="mr-1 h-3 w-3" />
                      Feed valid
                    </Badge>
                  )}
                  {discoveredApp.sourceValidationStatus === "invalid" && (
                    <Badge variant="destructive">
                      <X className="mr-1 h-3 w-3" />
                      Feed invalid
                    </Badge>
                  )}
                </div>

                {/* Enrichment preview */}
                {discoveredApp.enrichedLatestVersion && (
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>
                      Latest:{" "}
                      <span className="font-mono font-medium text-foreground">
                        {discoveredApp.enrichedLatestVersion}
                      </span>
                    </span>
                    {discoveredApp.enrichedLatestPublishedAt && (
                      <span>
                        Published: {discoveredApp.enrichedLatestPublishedAt.split("T")[0]}
                      </span>
                    )}
                    {discoveredApp.enrichedReleaseCount && (
                      <span>{discoveredApp.enrichedReleaseCount} releases</span>
                    )}
                  </div>
                )}

                <Separator />

                {/* App Identity */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">App Identity</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Canonical Name</Label>
                      <Input
                        value={canonicalName}
                        onChange={(e) => {
                          setCanonicalName(e.target.value);
                          setSlug(slugify(e.target.value));
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">
                        Slug
                        {slugCheck.data && (
                          <span
                            className={`ml-2 ${slugCheck.data.available ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {slugCheck.data.available ? "available" : "taken"}
                          </span>
                        )}
                      </Label>
                      <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Vendor Name</Label>
                      <Input
                        value={vendorName}
                        onChange={(e) => setVendorName(e.target.value)}
                        placeholder="Auto-detected or enter manually"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Homepage URL</Label>
                      <Input
                        value={homepageUrl}
                        onChange={(e) => setHomepageUrl(e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Optional..."
                      rows={2}
                    />
                  </div>
                </div>

                <Separator />

                {/* Aliases */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">
                      Aliases ({aliases.filter((a) => a.value.trim()).length})
                    </h4>
                    <Button variant="ghost" size="sm" onClick={addAlias}>
                      <Plus className="mr-1 h-3 w-3" />
                      Add
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {aliases.map((alias) => (
                      <div key={alias.key} className="flex items-center gap-2">
                        <select
                          value={alias.aliasType}
                          onChange={(e) => updateAlias(alias.key, "aliasType", e.target.value)}
                          className="h-9 rounded-md border bg-background px-2 text-xs w-24 shrink-0"
                        >
                          {Object.entries(aliasTypeLabels).map(([val, label]) => (
                            <option key={val} value={val}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <Input
                          value={alias.value}
                          onChange={(e) => updateAlias(alias.key, "value", e.target.value)}
                          className="text-xs font-mono"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 shrink-0"
                          onClick={() => removeAlias(alias.key)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Source */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Source</h4>
                  {source ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{source.sourceType}</Badge>
                        <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                          {source.baseUrl}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          onClick={() => setSource(null)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
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
                            variant={
                              validateSourceMutation.data.status === "valid"
                                ? "default"
                                : "destructive"
                            }
                            className={
                              validateSourceMutation.data.status === "valid" ? "bg-emerald-600" : ""
                            }
                          >
                            {validateSourceMutation.data.status === "valid"
                              ? `Valid (${validateSourceMutation.data.releaseCount} releases)`
                              : validateSourceMutation.data.status}
                          </Badge>
                        )}
                      </div>
                      {/* Show parsed releases preview */}
                      {validateSourceMutation.data?.releases &&
                        validateSourceMutation.data.releases.length > 0 && (
                          <div className="rounded-md border p-2 bg-muted/30">
                            <div className="text-xs font-medium mb-1">Release Preview</div>
                            {validateSourceMutation.data.releases.map((r) => (
                              <div
                                key={r.version}
                                className="flex items-center gap-2 text-xs py-0.5"
                              >
                                <span className="font-mono font-medium">{r.version}</span>
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                  {r.channel}
                                </Badge>
                                {r.publishedAt && (
                                  <span className="text-muted-foreground">
                                    {r.publishedAt.split("T")[0]}
                                  </span>
                                )}
                                <span className="text-muted-foreground">
                                  {r.artifactCount} artifact{r.artifactCount !== 1 ? "s" : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No update source detected. The app can be onboarded without one.
                    </p>
                  )}
                </div>
              </div>
            </ScrollArea>

            <Separator />

            {/* Action bar */}
            <div className="flex items-center gap-3 pt-4">
              <Button
                onClick={handleSubmit}
                disabled={!canSubmit || onboard.isPending}
                className="flex-1"
              >
                {onboard.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-4 w-4" />
                )}
                {onboard.isPending ? "Onboarding..." : "Onboard App"}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
