import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { ArrowUpRightIcon, DownloadIcon } from "lucide-react";
import posthogClient from "posthog-js";
import { useEffect, useEffectEvent, useRef } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  fetchReleases,
  type Release,
  countNightlyReleases,
  filterReleases,
  isNightlyRelease,
} from "@/lib/releases";
import { getPageSeoHead } from "@/lib/seo";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

const changelogSearchDefaults = {
  nightly: false,
} as const;

export const Route = createFileRoute("/changelog")({
  validateSearch: (search: Record<string, unknown>) => ({
    nightly: parseBooleanSearchParam(search.nightly),
  }),
  search: { middlewares: [stripSearchParams(changelogSearchDefaults)] },
  head: () =>
    getPageSeoHead({
      title: "Changelog",
      description: "Versioneer release notes and downloads.",
      path: "/changelog",
    }),
  loader: ({ abortController }) =>
    fetchReleases({
      signal: abortController.signal,
    }),
  onError: ({ error }) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    posthogClient.captureException(error, {
      flow: "changelog_releases",
    });
  },
  pendingComponent: ChangelogPendingPage,
  pendingMs: 200,
  pendingMinMs: 300,
  staleTime: 300_000,
  component: ChangelogPage,
});

function ChangelogPage() {
  const navigate = Route.useNavigate();
  const releases = Route.useLoaderData();
  const { nightly } = Route.useSearch();
  const scrolledRef = useRef(false);
  const nightlySwitchId = "show-nightly-releases";
  const visibleReleases = filterReleases(releases, nightly);
  const nightlyReleaseCount = countNightlyReleases(releases);

  const setNightly = useEffectEvent((nextNightly: boolean) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        nightly: nextNightly,
      }),
      replace: true,
    });
  });

  useEffect(() => {
    if (scrolledRef.current) return;

    const hash = window.location.hash.slice(1);
    if (!hash) {
      scrolledRef.current = true;
      return;
    }

    const targetRelease = releases.find((release) => release.tag_name === hash);
    if (targetRelease && isNightlyRelease(targetRelease) && !nightly) {
      setNightly(true);
      return;
    }

    const target = document.getElementById(hash);
    if (target) {
      scrolledRef.current = true;
      target.scrollIntoView({ behavior: "smooth" });
      return;
    }

    scrolledRef.current = true;
  }, [releases, nightly]);

  return (
    <main className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-medium">Changelog</h2>
        {nightlyReleaseCount > 0 ? (
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <Switch id={nightlySwitchId} size="sm" checked={nightly} onCheckedChange={setNightly} />
            <Label htmlFor={nightlySwitchId} className="cursor-pointer text-xs text-foreground/80">
              Show pre-releases
              <span className="text-foreground/60">({nightlyReleaseCount})</span>
            </Label>
          </div>
        ) : null}
      </div>

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

function ChangelogPendingPage() {
  return (
    <main className="space-y-4">
      <h2 className="text-lg font-medium">Changelog</h2>
      <ChangelogSkeleton />
    </main>
  );
}

function parseBooleanSearchParam(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

function ReleaseEntry({ release }: { release: Release }) {
  const date = release.published_at ? new Date(release.published_at) : null;

  return (
    <article
      id={release.tag_name}
      className="scroll-mt-24 border-l-2 border-foreground/10 pl-5 space-y-2"
    >
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <a
          href={`#${release.tag_name}`}
          className="font-mono text-sm font-medium text-foreground hover:text-foreground/80"
        >
          {release.tag_name}
        </a>
        {release.prerelease && (
          <span className="text-[11px] leading-none font-medium px-1.5 py-0.5 rounded-full border border-foreground/15 text-muted-foreground">
            Pre-release
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1 flex-wrap">
        {date && (
          <>
            <time dateTime={release.published_at!} className="text-xs text-muted-foreground/80">
              {dateFormatter.format(date)}
            </time>
            <span className="text-foreground/50 pointer-events-none">•</span>
          </>
        )}
        <a
          href={release.html_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            posthogClient.capture("marketing_release_link_clicked", {
              target_id: release.tag_name,
              target_url: release.html_url,
            })
          }
          className="text-muted-foreground/80 hover:text-muted-foreground text-xs inline-flex items-center gap-0.5"
        >
          GitHub
          <ArrowUpRightIcon className="size-3" />
        </a>
        {release.downloads && (
          <>
            <span className="text-foreground/35 pointer-events-none">•</span>
            <div className="inline-flex items-center gap-1 rounded-full border border-foreground/10 bg-foreground/[0.03] px-1 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <DownloadIcon className="size-3 text-foreground/45 ml-1" />
              <DownloadLink href={release.downloads.dmgUrl} release={release} assetType="dmg">
                DMG
              </DownloadLink>
              <span className="h-3.5 w-px bg-foreground/10" />
              <DownloadLink href={release.downloads.zipUrl} release={release} assetType="zip">
                ZIP
              </DownloadLink>
            </div>
          </>
        )}
      </div>

      {release.body_html && (
        <div className="prose" dangerouslySetInnerHTML={{ __html: release.body_html }} />
      )}
    </article>
  );
}

function DownloadLink({
  assetType,
  children,
  href,
  release,
}: {
  assetType: "dmg" | "zip";
  children: string;
  href: string;
  release: Release;
}) {
  return (
    <a
      href={href}
      aria-label={`Download ${release.tag_name} as ${assetType.toUpperCase()}`}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-foreground/72 transition-colors hover:text-foreground hover:bg-foreground/[0.05]"
      onClick={() =>
        posthogClient.capture("marketing_release_download_clicked", {
          artifact_type: assetType,
          target_id: release.tag_name,
          target_url: href,
        })
      }
    >
      {children}
    </a>
  );
}

function ChangelogSkeleton() {
  return (
    <div className="space-y-10">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="border-l-2 border-foreground/10 pl-5 space-y-3 animate-pulse">
          <div className="flex items-center gap-2.5">
            <div className="h-4 w-16 rounded bg-foreground/10" />
            <div className="h-3 w-24 rounded bg-foreground/10" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-foreground/10" />
            <div className="h-3 w-4/5 rounded bg-foreground/10" />
            <div className="h-3 w-3/5 rounded bg-foreground/10" />
          </div>
        </div>
      ))}
    </div>
  );
}
