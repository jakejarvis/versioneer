import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Release {
  tag_name: string;
  name: string | null;
  body_html: string | null;
  published_at: string | null;
  html_url: string;
  prerelease: boolean;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const Route = createFileRoute("/changelog")({
  component: ChangelogPage,
});

function ChangelogPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const scrolledRef = useRef(false);

  useEffect(() => {
    fetch("/api/releases")
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json() as Promise<Release[]>;
      })
      .then((data) => {
        setReleases(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (loading || scrolledRef.current) return;
    scrolledRef.current = true;

    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const target = document.getElementById(hash);
    if (target) {
      target.scrollIntoView({ behavior: "smooth" });
    }
  }, [loading]);

  return (
    <main className="space-y-4">
      <h2 className="text-lg font-medium">Changelog</h2>

      {loading && <ChangelogSkeleton />}

      {error && (
        <p className="text-sm text-muted-foreground">Failed to load releases. Try again later.</p>
      )}

      {!loading && !error && releases.length === 0 && (
        <p className="text-sm text-muted-foreground">No releases found.</p>
      )}

      {!loading && !error && (
        <div className="space-y-10">
          {releases.map((release) => (
            <ReleaseEntry key={release.tag_name} release={release} />
          ))}
        </div>
      )}
    </main>
  );
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
            pre-release
          </span>
        )}
        <a
          href={release.html_url}
          target="_blank"
          rel="noopener noreferrer"
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
