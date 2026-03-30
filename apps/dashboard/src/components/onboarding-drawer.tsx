import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useForm, useStore } from "@tanstack/react-form";
import { parseGitHubRepoUrl, resolveSourceUrl } from "@versioneer/core/validation";
import type { SourceType } from "@versioneer/schemas/sources";
import { SOURCE_TYPE_DEFAULTS } from "@versioneer/schemas/sources";
import { format } from "date-fns";
import {
  Check,
  CircleAlert,
  ExternalLink,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { useDiscoveredApp } from "@/api/hooks/use-discovered-apps";
import {
  useCheckSlugAvailable,
  useLookupCaskToken,
  useOnboardDiscoveredApp,
  useValidateSource,
} from "@/api/hooks/use-onboarding";
import { AppIcon } from "@/components/shared/app-icon";
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
import { SOURCE_TYPES } from "@/lib/source-types";

// ──────────────────────────────────────────────────────────
// Alias types — identity matchers only
// ──────────────────────────────────────────────────────────

type AliasType = "bundle_id" | "name" | "team_id" | "homebrew_cask" | "mas_app_id";

interface AliasEntry {
  key: string;
  aliasType: AliasType;
  value: string;
}

const ALIAS_COLORS: Record<AliasType, string> = {
  bundle_id: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  name: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  team_id: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  homebrew_cask: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  mas_app_id: "bg-pink-500/10 text-pink-400 border-pink-500/20",
};

const ALIAS_LABELS: Record<AliasType, string> = {
  bundle_id: "Bundle ID",
  name: "Name",
  team_id: "Team ID",
  homebrew_cask: "Homebrew",
  mas_app_id: "App Store",
};

// ──────────────────────────────────────────────────────────
// Source types — update feeds
// ──────────────────────────────────────────────────────────

interface SourceEntry {
  key: string;
  sourceType: SourceType;
  identifier: string;
  pollIntervalMinutes: number;
  label?: string;
  status?: "active" | "paused";
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "MMM d, yyyy");
}

interface OnboardingFormData {
  canonicalName: string;
  slug: string;
  vendorName: string;
  homepageUrl: string;
  notes: string;
  aliases: AliasEntry[];
  sources: SourceEntry[];
  sourceValidated: boolean;
}

// ──────────────────────────────────────────────────────────
// Build initial form values from a discovered app record
// ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInitialValues(discoveredApp: any): OnboardingFormData {
  const aliases: AliasEntry[] = [];
  if (discoveredApp.bundleId) {
    aliases.push({
      key: crypto.randomUUID(),
      aliasType: "bundle_id",
      value: discoveredApp.bundleId,
    });
  }
  aliases.push({ key: crypto.randomUUID(), aliasType: "name", value: discoveredApp.appName });
  if (discoveredApp.teamId) {
    aliases.push({ key: crypto.randomUUID(), aliasType: "team_id", value: discoveredApp.teamId });
  }

  const sources: SourceEntry[] = [];
  if (discoveredApp.sparkleFeedUrl) {
    sources.push({
      key: crypto.randomUUID(),
      sourceType: "sparkle",
      identifier: discoveredApp.sparkleFeedUrl,
      pollIntervalMinutes: 60,
      status: "active",
    });
  }
  if (discoveredApp.electronUpdateUrl) {
    const parsed = parseGitHubRepoUrl(discoveredApp.electronUpdateUrl);
    if (parsed) {
      sources.push({
        key: crypto.randomUUID(),
        sourceType: "github_releases",
        identifier: `${parsed.owner}/${parsed.repo}`,
        pollIntervalMinutes: 60,
        status: "active",
      });
    } else {
      sources.push({
        key: crypto.randomUUID(),
        sourceType: "electron_generic",
        identifier: discoveredApp.electronUpdateUrl,
        pollIntervalMinutes: 60,
        status: "active",
      });
    }
  }
  if (discoveredApp.isMasApp && discoveredApp.bundleId && sources.length === 0) {
    sources.push({
      key: crypto.randomUUID(),
      sourceType: "mac_app_store",
      identifier: discoveredApp.bundleId,
      pollIntervalMinutes: 1440,
      status: "active",
    });
  }

  return {
    canonicalName: discoveredApp.appName,
    slug: slugify(discoveredApp.appName),
    vendorName: discoveredApp.enrichedVendorName ?? "",
    homepageUrl: discoveredApp.enrichedHomepageUrl ?? "",
    notes: "",
    aliases,
    sources,
    sourceValidated: discoveredApp.sourceValidationStatus === "valid",
  };
}

// ──────────────────────────────────────────────────────────
// Outer shell — data fetching + sheet chrome
// ──────────────────────────────────────────────────────────

interface Props {
  discoveredAppId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (appId: string, status: "draft" | "public") => void;
}

export function OnboardingDrawer({ discoveredAppId, open, onOpenChange, onSuccess }: Props) {
  const { data: discoveredApp, isLoading } = useDiscoveredApp(open ? discoveredAppId : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        {/* Header */}
        <SheetHeader className="shrink-0 px-5 pb-4 pt-5">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-base">Onboard New App</SheetTitle>
              <SheetDescription className="mt-0.5 text-xs">
                Review pre-populated data, then submit a draft and source suggestions for catalog
                review.
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="-mr-1 -mt-1 h-7 w-7 p-0"
              onClick={() => onOpenChange(false)}
            >
              <X />
            </Button>
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !discoveredApp ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            App not found.
          </div>
        ) : (
          <OnboardingFormContent
            key={discoveredApp.id}
            discoveredApp={discoveredApp}
            discoveredAppId={discoveredAppId!}
            onOpenChange={onOpenChange}
            onSuccess={onSuccess}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ──────────────────────────────────────────────────────────
// Inner form — only mounted when discoveredApp is available,
// so defaultValues is always correct from the first render.
// ──────────────────────────────────────────────────────────

function OnboardingFormContent({
  discoveredApp,
  discoveredAppId,
  onOpenChange,
  onSuccess,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  discoveredApp: any;
  discoveredAppId: string;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (appId: string, status: "draft" | "public") => void;
}) {
  const onboard = useOnboardDiscoveredApp();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on id; component remounts when id changes
  const initialValues = useMemo(() => buildInitialValues(discoveredApp), [discoveredApp.id]);
  const enrichmentHasReleases = (discoveredApp.enrichedReleaseCount ?? 0) > 0;

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      onboard.mutate(
        {
          discoveredAppId,
          app: {
            slug: value.slug,
            canonicalName: value.canonicalName,
            vendorName: value.vendorName || undefined,
            homepageUrl: value.homepageUrl || undefined,
            notes: value.notes || undefined,
          },
          aliases: value.aliases
            .filter((a) => a.value.trim())
            .map((a) => ({ aliasType: a.aliasType, value: a.value })),
          sources: value.sources
            .filter((s) => s.identifier.trim())
            .map((s) => {
              const baseUrl = resolveSourceUrl(s.sourceType, s.identifier);
              return {
                sourceType: s.sourceType,
                baseUrl: baseUrl ?? "",
                parserKey: s.sourceType,
                pollIntervalMinutes: s.pollIntervalMinutes,
                label: s.label,
                status: s.status,
              };
            })
            .filter((s) => s.baseUrl),
          sourceValidated: value.sourceValidated,
          enrichmentHasReleases,
        },
        {
          onSuccess: (data) => {
            onOpenChange(false);
            onSuccess?.(data.id, data.status);
          },
          onError: (err) => {
            toast.error(err.message || "Failed to onboard app");
          },
        },
      );
    },
  });

  const slug = useStore(form.store, (s) => s.values.slug);
  const slugCheck = useCheckSlugAvailable(slug);

  // On-demand cask token lookup when discovered app has bundleId but no cask token
  const needsCaskLookup = !!discoveredApp.bundleId && !discoveredApp.homebrewCaskToken;
  const caskLookup = useLookupCaskToken(needsCaskLookup ? discoveredApp.bundleId : null);
  const resolvedCaskToken = discoveredApp.homebrewCaskToken ?? caskLookup.data?.caskToken ?? null;

  // Add cask alias and source once the token resolves (additive — doesn't reset the form).
  useEffect(() => {
    if (!resolvedCaskToken) return;

    const currentAliases = form.getFieldValue("aliases");
    if (!currentAliases.some((a) => a.aliasType === "homebrew_cask")) {
      form.pushFieldValue("aliases", {
        key: crypto.randomUUID(),
        aliasType: "homebrew_cask" as AliasType,
        value: resolvedCaskToken,
      });
    }

    const currentSources = form.getFieldValue("sources");
    if (currentSources.length === 0) {
      form.pushFieldValue("sources", {
        key: crypto.randomUUID(),
        sourceType: "homebrew_cask",
        identifier: resolvedCaskToken,
        pollIntervalMinutes: 360,
        status: "active",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedCaskToken]);

  const confidenceScore = discoveredApp.confidenceScore ?? 0;
  const slugManuallyEdited = useRef(false);

  const canonicalName = useStore(form.store, (s) => s.values.canonicalName);
  const canSubmit =
    slug.length > 0 && canonicalName.length > 0 && slugCheck.data?.available !== false;

  return (
    <>
      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          id="onboarding-form"
          className="space-y-5 px-5 pb-5"
        >
          {/* Confidence + enrichment summary */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <div className="flex items-center gap-3">
              <ConfidenceRing score={confidenceScore} />
              <AppIcon
                iconR2Key={discoveredApp.iconR2Key ?? null}
                appName={discoveredApp.appName}
                size={40}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{discoveredApp.appName}</div>
                {discoveredApp.bundleId && (
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {discoveredApp.bundleId}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {discoveredApp.sourceValidationStatus === "valid" ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400"
                  >
                    <Check className="mr-0.5 h-2.5 w-2.5" />
                    Feed valid
                  </Badge>
                ) : discoveredApp.sourceValidationStatus === "invalid" ? (
                  <Badge
                    variant="outline"
                    className="border-red-500/30 bg-red-500/10 text-[10px] text-red-400"
                  >
                    <CircleAlert className="mr-0.5 h-2.5 w-2.5" />
                    Feed invalid
                  </Badge>
                ) : null}
              </div>
            </div>
            {discoveredApp.enrichedLatestVersion && (
              <div className="mt-2.5 flex items-center gap-3 border-t border-border/40 pt-2.5 text-[11px] text-muted-foreground">
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
                <form.Field name="canonicalName">
                  {(field) => (
                    <FieldGroup label="Canonical Name">
                      <Input
                        value={field.state.value}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                          if (!slugManuallyEdited.current) {
                            const newSlug = slugify(e.target.value);
                            form.setFieldValue("slug", newSlug);
                          }
                        }}
                        className="h-8 text-sm"
                      />
                    </FieldGroup>
                  )}
                </form.Field>
                <form.Field name="slug">
                  {(field) => (
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
                        value={field.state.value}
                        onChange={(e) => {
                          slugManuallyEdited.current = true;
                          field.handleChange(e.target.value);
                        }}
                        className="h-8 font-mono text-sm"
                      />
                    </FieldGroup>
                  )}
                </form.Field>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <form.Field name="vendorName">
                  {(field) => (
                    <FieldGroup label="Vendor">
                      <Input
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Auto-detected or manual"
                        className="h-8 text-sm"
                      />
                    </FieldGroup>
                  )}
                </form.Field>
                <form.Field name="homepageUrl">
                  {(field) => (
                    <FieldGroup label="Homepage">
                      <div className="relative">
                        <Input
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          placeholder="https://..."
                          className="h-8 pr-7 text-sm"
                        />
                        {field.state.value && (
                          <a
                            href={field.state.value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </FieldGroup>
                  )}
                </form.Field>
              </div>
              <form.Field name="notes">
                {(field) => (
                  <FieldGroup label="Notes">
                    <Textarea
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Optional notes..."
                      rows={2}
                      className="resize-none text-sm"
                    />
                  </FieldGroup>
                )}
              </form.Field>
            </div>
          </section>

          <Separator className="opacity-40" />

          {/* Aliases (identity matchers only) */}
          <section>
            <div className="flex items-center justify-between">
              <form.Subscribe
                selector={(s) => s.values.aliases.filter((a: AliasEntry) => a.value.trim()).length}
              >
                {(count) => <SectionHeader label={`Aliases (${count})`} />}
              </form.Subscribe>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  form.pushFieldValue("aliases", {
                    key: crypto.randomUUID(),
                    aliasType: "bundle_id",
                    value: "",
                  })
                }
              >
                <Plus />
                Add
              </Button>
            </div>
            <form.Field name="aliases" mode="array">
              {(aliasesField) => (
                <div className="mt-2.5 space-y-1.5">
                  {aliasesField.state.value.map((alias, i) => (
                    <div
                      key={alias.key}
                      className="group flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 p-1 pl-1.5"
                    >
                      <form.Field name={`aliases[${i}].aliasType`}>
                        {(field) => (
                          <select
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value as AliasType)}
                            className={`h-6 shrink-0 cursor-pointer appearance-none rounded border px-1.5 text-[10px] font-medium ${ALIAS_COLORS[field.state.value as AliasType]}`}
                          >
                            {Object.entries(ALIAS_LABELS).map(([val, label]) => (
                              <option key={val} value={val}>
                                {label}
                              </option>
                            ))}
                          </select>
                        )}
                      </form.Field>
                      <form.Field name={`aliases[${i}].value`}>
                        {(field) => (
                          <input
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
                            placeholder="value..."
                          />
                        )}
                      </form.Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => aliasesField.removeValue(i)}
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </form.Field>
          </section>

          <Separator className="opacity-40" />

          {/* Sources (update feeds) */}
          <section>
            <div className="flex items-center justify-between">
              <form.Subscribe
                selector={(s) =>
                  s.values.sources.filter((src: SourceEntry) => src.identifier.trim()).length
                }
              >
                {(count) => <SectionHeader label={`Sources (${count})`} />}
              </form.Subscribe>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  form.pushFieldValue("sources", {
                    key: crypto.randomUUID(),
                    sourceType: "sparkle" as SourceType,
                    identifier: "",
                    pollIntervalMinutes: 60,
                    status: "active",
                  })
                }
              >
                <Plus />
                Add
              </Button>
            </div>
            <form.Field name="sources" mode="array">
              {(sourcesField) =>
                sourcesField.state.value.length > 0 ? (
                  <DragDropProvider
                    onDragEnd={(event: any) => {
                      const src = event.operation.source;
                      const tgt = event.operation.target;
                      if (!src || !tgt || src.id === tgt.id) return;
                      const items = sourcesField.state.value;
                      const oldIdx = items.findIndex((s: SourceEntry) => s.key === src.id);
                      const newIdx = items.findIndex((s: SourceEntry) => s.key === tgt.id);
                      if (oldIdx === -1 || newIdx === -1) return;
                      const reordered = [...items];
                      const [moved] = reordered.splice(oldIdx, 1);
                      reordered.splice(newIdx, 0, moved!);
                      form.setFieldValue("sources", reordered);
                    }}
                  >
                    <div className="mt-2.5 space-y-2.5">
                      {sourcesField.state.value.map((source: SourceEntry, i: number) => (
                        <SortableSourceWrapper key={source.key} id={source.key} index={i}>
                          <SourceCard
                            form={form}
                            index={i}
                            source={source}
                            onRemove={() => {
                              sourcesField.removeValue(i);
                              // Only reset validation if all sources are removed;
                              // remaining sources were already validated as part of
                              // the previous set and don't need re-validation.
                              if (sourcesField.state.value.length <= 1) {
                                form.setFieldValue("sourceValidated", false);
                              }
                            }}
                            onValidated={() => form.setFieldValue("sourceValidated", true)}
                          />
                        </SortableSourceWrapper>
                      ))}
                    </div>
                  </DragDropProvider>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground/70">
                    No update sources. The app can be onboarded without one.
                  </p>
                )
              }
            </form.Field>
          </section>
        </form>
      </div>

      {/* Sticky footer */}
      <SheetFooter className="border-t border-border/60 bg-background/80 px-5 py-3.5 backdrop-blur-sm">
        <div className="flex w-full items-center gap-2.5">
          <Button
            type="submit"
            form="onboarding-form"
            disabled={!canSubmit || onboard.isPending}
            size="sm"
            className="h-8 flex-1"
          >
            {onboard.isPending ? <Loader2 className="animate-spin" /> : <Zap />}
            {onboard.isPending ? "Onboarding..." : "Onboard App"}
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </SheetFooter>
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Sortable wrapper for source cards during onboarding
// ──────────────────────────────────────────────────────────

function SortableSourceWrapper({
  id,
  index,
  children,
}: {
  id: string;
  index: number;
  children: React.ReactNode;
}) {
  const { ref } = useSortable({ id, index });

  return (
    <div ref={ref} className="flex items-start gap-1.5">
      <GripVertical className="mt-3 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Source Card (per-source test feed + editing)
// ──────────────────────────────────────────────────────────

function SourceCard({
  form,
  index,
  source,
  onRemove,
  onValidated,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  index: number;
  source: SourceEntry;
  onRemove: () => void;
  onValidated: () => void;
}) {
  // Subscribe directly to current field values so the test button and handler
  // stay in sync as the user types (the `source` prop from the parent array
  // field does not re-render on nested field changes).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentSourceType: SourceType = useStore(form.store, (s: any) => s.values.sources[index]?.sourceType) ?? source.sourceType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentIdentifier: string = useStore(form.store, (s: any) => s.values.sources[index]?.identifier) ?? source.identifier;

  const validateMutation = useValidateSource();

  const handleTestFeed = useCallback(() => {
    if (!SOURCE_TYPE_DEFAULTS[currentSourceType].validatable) return;
    const url = resolveSourceUrl(currentSourceType, currentIdentifier);
    if (!url) return;
    validateMutation.mutate(
      {
        url,
        sourceType: currentSourceType as
          | "sparkle"
          | "github_releases"
          | "homebrew_cask"
          | "mac_app_store"
          | "electron_generic",
      },
      {
        onSuccess: (data) => {
          if (data.status === "valid") onValidated();
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSourceType, currentIdentifier]);

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-muted/20 p-2.5">
      <div className="flex items-center gap-2">
        <form.Field name={`sources[${index}].sourceType`}>
          {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
            <select
              value={field.state.value}
              onChange={(e) => {
                const newType = e.target.value as SourceType;
                field.handleChange(newType);
                form.setFieldValue(`sources[${index}].identifier`, "");
                form.setFieldValue(
                  `sources[${index}].pollIntervalMinutes`,
                  SOURCE_TYPE_DEFAULTS[newType].pollIntervalMinutes,
                );
                form.setFieldValue("sourceValidated", false);
              }}
              className={`h-6 shrink-0 cursor-pointer appearance-none rounded border px-1.5 text-[10px] font-medium ${SOURCE_TYPES[field.state.value as SourceType].color}`}
            >
              {Object.entries(SOURCE_TYPES).map(([val, cfg]) => (
                <option key={val} value={val}>
                  {cfg.label}
                </option>
              ))}
            </select>
          )}
        </form.Field>
        <form.Field name={`sources[${index}].identifier`}>
          {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
            <input
              value={field.state.value}
              onChange={(e) => {
                field.handleChange(e.target.value);
                form.setFieldValue("sourceValidated", false);
              }}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-muted-foreground outline-none placeholder:text-muted-foreground/40"
              placeholder={SOURCE_TYPES[currentSourceType].input.placeholder}
            />
          )}
        </form.Field>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 w-5 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {currentSourceType !== "manual" && currentIdentifier && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 text-[10px]"
            onClick={handleTestFeed}
            disabled={validateMutation.isPending}
          >
            {validateMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Test
          </Button>
          {validateMutation.data && (
            <Badge
              variant="outline"
              className={`text-[10px] ${
                validateMutation.data.status === "valid"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}
            >
              {validateMutation.data.status === "valid" ? (
                <>
                  <Check className="mr-0.5 h-2.5 w-2.5" />
                  {validateMutation.data.releaseCount} releases
                </>
              ) : (
                validateMutation.data.status
              )}
            </Badge>
          )}
        </div>
      )}

      {validateMutation.data?.releases && validateMutation.data.releases.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border/40 bg-muted/20">
          <div className="border-b border-border/30 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Release Preview
          </div>
          <div className="divide-y divide-border/20">
            {validateMutation.data.releases.map((r) => (
              <div key={r.version} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <span className="font-mono font-medium text-foreground">{r.version}</span>
                <Badge variant="outline" className="border-border/40 px-1 py-0 text-[9px]">
                  {r.channel}
                </Badge>
                <span className="flex-1" />
                {r.publishedAt && (
                  <span className="tabular-nums text-[11px] text-muted-foreground">
                    {formatDate(r.publishedAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Shared sub-components
// ──────────────────────────────────────────────────────────

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
