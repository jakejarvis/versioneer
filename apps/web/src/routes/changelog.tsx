import { createFileRoute } from "@tanstack/react-router";
import phClient from "posthog-js";
import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { type Release, getMarketingReleases } from "@/lib/releases";
import { getPageSeoHead } from "@/lib/seo";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const Route = createFileRoute("/changelog")({
  head: () =>
    getPageSeoHead({
      title: "Changelog",
      description: "Versioneer release notes and downloads.",
      path: "/changelog",
    }),
  loader: () => getMarketingReleases(),
  component: ChangelogPage,
});

function ChangelogPage() {
  const releases = Route.useLoaderData();
  const [showPrereleases, setShowPrereleases] = useState(false);
  const stableReleases = releases.filter((release) => !release.prerelease);
  const prereleaseCount = releases.length - stableReleases.length;
  const visibleReleases = showPrereleases ? releases : stableReleases;

  return (
    <main className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-medium">Changelog</h2>
        {prereleaseCount > 0 ? (
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <Switch
              id="show-prereleases"
              size="sm"
              checked={showPrereleases}
              onCheckedChange={setShowPrereleases}
            />
            <Label htmlFor="show-prereleases" className="cursor-pointer text-xs text-foreground/80">
              Show pre-releases
              <span className="text-foreground/60">({prereleaseCount})</span>
            </Label>
          </div>
        ) : null}
      </header>

      {visibleReleases.length > 0 ? (
        <div className="space-y-10">
          {visibleReleases.map((release) => (
            <ReleaseEntry key={release.tag_name} release={release} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No releases found.</p>
      )}
    </main>
  );
}

function ReleaseEntry({ release }: { release: Release }) {
  return (
    <article
      id={release.tag_name}
      className="scroll-mt-24 space-y-2 border-l-2 border-foreground/10 pl-5"
    >
      <div className="flex flex-wrap items-baseline gap-2.5">
        <a
          href={`#${release.tag_name}`}
          className="font-mono text-sm font-medium text-foreground hover:text-foreground/80"
        >
          {release.tag_name}
        </a>
        {release.prerelease ? (
          <span className="rounded-full border border-foreground/15 px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
            Pre-release
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-1 text-xs text-muted-foreground/80">
        {release.published_at ? (
          <>
            <time dateTime={release.published_at}>
              {dateFormatter.format(new Date(release.published_at))}
            </time>
            <span className="text-foreground/50">/</span>
          </>
        ) : null}
        <a
          href={release.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground"
        >
          GitHub
        </a>
        {release.downloads ? (
          <>
            <span className="text-foreground/35">/</span>
            <a
              href={release.downloads.dmgUrl}
              onClick={() =>
                phClient.capture("marketing_download_clicked", {
                  artifact_type: "dmg",
                  target_id: release.tag_name,
                  target_url: release.downloads?.dmgUrl,
                })
              }
              className="font-medium text-foreground/75"
            >
              DMG
            </a>
            <span className="text-foreground/35">/</span>
            <a
              href={release.downloads.zipUrl}
              onClick={() =>
                phClient.capture("marketing_download_clicked", {
                  artifact_type: "zip",
                  target_id: release.tag_name,
                  target_url: release.downloads?.zipUrl,
                })
              }
              className="font-medium text-foreground/75"
            >
              ZIP
            </a>
          </>
        ) : null}
      </div>

      {release.body_html ? (
        <div className="prose" dangerouslySetInnerHTML={{ __html: release.body_html }} />
      ) : null}
    </article>
  );
}
