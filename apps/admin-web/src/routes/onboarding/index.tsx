import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useApproveDiscoveredApp } from "@/api/hooks/use-discovered-apps";
import { useOnboardApp } from "@/api/hooks/use-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface OnboardingSearch {
  discoveredAppId?: string;
  appName?: string;
  bundleId?: string;
  teamId?: string;
}

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingPage,
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => ({
    discoveredAppId:
      typeof search.discoveredAppId === "string" ? search.discoveredAppId : undefined,
    appName: typeof search.appName === "string" ? search.appName : undefined,
    bundleId: typeof search.bundleId === "string" ? search.bundleId : undefined,
    teamId: typeof search.teamId === "string" ? search.teamId : undefined,
  }),
});

interface AppData {
  slug: string;
  canonicalName: string;
  vendorName: string;
  homepageUrl: string;
  notes: string;
}

type AliasType =
  | "bundle_id"
  | "name"
  | "team_id"
  | "sparkle_feed"
  | "homepage"
  | "download_pattern"
  | "github_repo"
  | "mas_app_id";

type SourceType = "sparkle" | "github_releases" | "manual";

interface AliasData {
  key: string;
  aliasType: AliasType;
  value: string;
}

interface SourceData {
  sourceType: SourceType;
  label: string;
  baseUrl: string;
  parserKey: string;
  pollIntervalMinutes: number;
}

const steps = ["App Details", "Aliases", "Source", "Review"];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function OnboardingPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/onboarding/" });
  const onboardApp = useOnboardApp();
  const approveDiscoveredApp = useApproveDiscoveredApp();
  const [step, setStep] = useState(0);

  const initialAliases: AliasData[] = [];
  if (search.bundleId) {
    initialAliases.push({
      key: crypto.randomUUID(),
      aliasType: "bundle_id",
      value: search.bundleId,
    });
  }
  if (search.appName) {
    initialAliases.push({ key: crypto.randomUUID(), aliasType: "name", value: search.appName });
  }
  if (initialAliases.length === 0) {
    initialAliases.push({ key: crypto.randomUUID(), aliasType: "bundle_id", value: "" });
  }

  const [appData, setAppData] = useState<AppData>({
    slug: search.appName ? slugify(search.appName) : "",
    canonicalName: search.appName ?? "",
    vendorName: "",
    homepageUrl: "",
    notes: "",
  });

  const [aliases, setAliases] = useState<AliasData[]>(initialAliases);

  const [sourceData, setSourceData] = useState<SourceData>({
    sourceType: "sparkle",
    label: "",
    baseUrl: "",
    parserKey: "sparkle",
    pollIntervalMinutes: 60,
  });

  const handleSubmit = () => {
    onboardApp.mutate(
      {
        app: {
          slug: appData.slug,
          canonicalName: appData.canonicalName,
          vendorName: appData.vendorName || undefined,
          homepageUrl: appData.homepageUrl || undefined,
          notes: appData.notes || undefined,
        },
        aliases: aliases
          .filter((a) => a.value)
          .map((a) => ({ aliasType: a.aliasType, value: a.value })),
        source: sourceData.baseUrl
          ? {
              sourceType: sourceData.sourceType,
              label: sourceData.label || undefined,
              baseUrl: sourceData.baseUrl,
              parserKey: sourceData.parserKey,
              pollIntervalMinutes: sourceData.pollIntervalMinutes,
            }
          : undefined,
      },
      {
        onSuccess: (data) => {
          // Mark discovered app as approved if we came from discovered apps
          if (search.discoveredAppId) {
            approveDiscoveredApp.mutate({ id: search.discoveredAppId, appId: data.id });
          }
          toast.success("App onboarded successfully");
          void navigate({ to: "/apps/$appId", params: { appId: data.id } });
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Onboard New App</h2>
      <p className="mt-1 text-muted-foreground">
        Guided workflow for adding a new app to the catalog.
      </p>

      <div className="mt-6 flex gap-2">
        {steps.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {i < step ? <Check className="h-3 w-3" /> : <span className="text-xs">{i + 1}</span>}
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 max-w-2xl">
        {step === 0 && <AppStep data={appData} onChange={setAppData} />}
        {step === 1 && <AliasStep aliases={aliases} onChange={setAliases} />}
        {step === 2 && <SourceStep data={sourceData} onChange={setSourceData} />}
        {step === 3 && <ReviewStep appData={appData} aliases={aliases} sourceData={sourceData} />}
      </div>

      <div className="mt-6 flex gap-3">
        {step > 0 && (
          <Button variant="outline" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={step === 0 && (!appData.slug || !appData.canonicalName)}
          >
            Next <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={onboardApp.isPending || !appData.slug || !appData.canonicalName}
          >
            {onboardApp.isPending ? "Onboarding..." : "Submit"}
          </Button>
        )}
      </div>
    </div>
  );
}

function AppStep({ data, onChange }: { data: AppData; onChange: (d: AppData) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Slug (required)</Label>
        <Input
          placeholder="iterm2"
          value={data.slug}
          onChange={(e) => onChange({ ...data, slug: e.target.value })}
        />
      </div>
      <div>
        <Label>Canonical Name (required)</Label>
        <Input
          placeholder="iTerm2"
          value={data.canonicalName}
          onChange={(e) => onChange({ ...data, canonicalName: e.target.value })}
        />
      </div>
      <div>
        <Label>Vendor Name</Label>
        <Input
          placeholder="George Nachman"
          value={data.vendorName}
          onChange={(e) => onChange({ ...data, vendorName: e.target.value })}
        />
      </div>
      <div>
        <Label>Homepage URL</Label>
        <Input
          placeholder="https://iterm2.com"
          value={data.homepageUrl}
          onChange={(e) => onChange({ ...data, homepageUrl: e.target.value })}
        />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea
          placeholder="Optional notes..."
          value={data.notes}
          onChange={(e) => onChange({ ...data, notes: e.target.value })}
        />
      </div>
    </div>
  );
}

function AliasStep({
  aliases,
  onChange,
}: {
  aliases: AliasData[];
  onChange: (a: AliasData[]) => void;
}) {
  const addAlias = () =>
    onChange([...aliases, { key: crypto.randomUUID(), aliasType: "bundle_id", value: "" }]);
  const removeAlias = (i: number) => onChange(aliases.filter((_, idx) => idx !== i));
  const updateAlias = (i: number, field: keyof Omit<AliasData, "key">, val: string) =>
    onChange(aliases.map((a, idx) => (idx === i ? ({ ...a, [field]: val } as AliasData) : a)));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Add identifiers the client can match against.</p>
      {aliases.map((alias, i) => (
        <div key={alias.key} className="flex items-end gap-3">
          <div className="w-40">
            <Label>Type</Label>
            <Select value={alias.aliasType} onValueChange={(v) => updateAlias(i, "aliasType", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bundle_id">Bundle ID</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="team_id">Team ID</SelectItem>
                <SelectItem value="sparkle_feed">Sparkle Feed</SelectItem>
                <SelectItem value="github_repo">GitHub Repo</SelectItem>
                <SelectItem value="mas_app_id">App Store ID</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label>Value</Label>
            <Input
              placeholder="com.example.app"
              value={alias.value}
              onChange={(e) => updateAlias(i, "value", e.target.value)}
            />
          </div>
          {aliases.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => removeAlias(i)}>
              Remove
            </Button>
          )}
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addAlias}>
        Add Alias
      </Button>
    </div>
  );
}

function SourceStep({ data, onChange }: { data: SourceData; onChange: (d: SourceData) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure the update source. Leave URL blank to skip.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Source Type</Label>
          <Select
            value={data.sourceType}
            onValueChange={(v) =>
              onChange({
                ...data,
                sourceType: v as SourceType,
                parserKey: v === "github_releases" ? "github_releases" : "sparkle",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sparkle">Sparkle</SelectItem>
              <SelectItem value="github_releases">GitHub Releases</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Label</Label>
          <Input
            placeholder="Main feed"
            value={data.label}
            onChange={(e) => onChange({ ...data, label: e.target.value })}
          />
        </div>
      </div>
      <div>
        <Label>Base URL</Label>
        <Input
          placeholder="https://example.com/appcast.xml"
          value={data.baseUrl}
          onChange={(e) => onChange({ ...data, baseUrl: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Parser Key</Label>
          <Input
            value={data.parserKey}
            onChange={(e) => onChange({ ...data, parserKey: e.target.value })}
          />
        </div>
        <div>
          <Label>Poll Interval (minutes)</Label>
          <Input
            type="number"
            min={5}
            value={data.pollIntervalMinutes}
            onChange={(e) => onChange({ ...data, pollIntervalMinutes: Number(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}

function ReviewStep({
  appData,
  aliases,
  sourceData,
}: {
  appData: AppData;
  aliases: AliasData[];
  sourceData: SourceData;
}) {
  const validAliases = aliases.filter((a) => a.value);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <h4 className="font-medium">App</h4>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 text-muted-foreground">Slug</dt>
            <dd className="font-mono">{appData.slug}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 text-muted-foreground">Name</dt>
            <dd>{appData.canonicalName}</dd>
          </div>
          {appData.vendorName && (
            <div className="flex gap-2">
              <dt className="w-28 text-muted-foreground">Vendor</dt>
              <dd>{appData.vendorName}</dd>
            </div>
          )}
        </dl>
      </div>
      {validAliases.length > 0 && (
        <div className="rounded-lg border p-4">
          <h4 className="font-medium">Aliases ({validAliases.length})</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {validAliases.map((a) => (
              <li key={a.key} className="font-mono">
                {a.aliasType}: {a.value}
              </li>
            ))}
          </ul>
        </div>
      )}
      {sourceData.baseUrl && (
        <div className="rounded-lg border p-4">
          <h4 className="font-medium">Source</h4>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-28 text-muted-foreground">Type</dt>
              <dd>{sourceData.sourceType}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 text-muted-foreground">URL</dt>
              <dd className="font-mono break-all">{sourceData.baseUrl}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 text-muted-foreground">Parser</dt>
              <dd>{sourceData.parserKey}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
