import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import posthogClient from "posthog-js";
import { useEffect, useRef } from "react";

import { fetchChangelogReleases, type ChangelogRelease } from "@/lib/releases";
import { getPageSeoHead } from "@/lib/seo";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const Route = createFileRoute("/changelog")({
  head: () =>
    getPageSeoHead({
      title: "Changelog | Versioneer",
      description:
        "Follow Versioneer releases, changelog entries, and shipping progress for the macOS app updater.",
      path: "/changelog",
    }),
  loader: ({ abortController }) =>
    fetchChangelogReleases({
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
  const releases = Route.useLoaderData();
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (scrolledRef.current) return;
    scrolledRef.current = true;

    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const target = document.getElementById(hash);
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  return (
    <main className="space-y-4">
      <h2 className="text-lg font-medium">Changelog</h2>

      {releases.length > 0 ? (
        <div className="space-y-10">
          {releases.map((release) => (
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

function ReleaseEntry({ release }: { release: ChangelogRelease }) {
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
            pre-release
          </span>
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
          className="text-muted-foreground/60 hover:text-muted-foreground text-xs inline-flex items-center gap-0.5"
        >
          GitHub
          <ArrowUpRightIcon className="size-3" />
        </a>
      </div>

      {date && (
        <time dateTime={release.published_at!} className="block text-xs text-muted-foreground/60">
          {dateFormatter.format(date)}
        </time>
      )}

      {release.body_html && (
        <div
          className="prose"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-rendered by GitHub API
          dangerouslySetInnerHTML={{ __html: release.body_html }}
        />
      )}
    </article>
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
