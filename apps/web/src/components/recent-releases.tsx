import { useEffect, useState } from "react";

const API_BASE_URL = "https://api.versioneer.app";

interface RecentRelease {
  appId: string;
  appName: string;
  appSlug: string;
  vendorName: string | null;
  iconUrl: string | null;
  releaseId: string;
  version: string;
  releasedAt: string;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.round((now - then) / 1000);

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unit, seconds] of units) {
    if (diffSeconds >= seconds) {
      return rtf.format(-Math.floor(diffSeconds / seconds), unit);
    }
  }

  return rtf.format(-diffSeconds, "second");
}

function SkeletonRows() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 animate-pulse">
          <div className="size-6 rounded bg-foreground/10 shrink-0" />
          <div className="h-4 w-28 rounded bg-foreground/10" />
          <div className="h-4 w-16 rounded bg-foreground/10" />
          <div className="ml-auto h-3.5 w-20 rounded bg-foreground/10" />
        </li>
      ))}
    </ul>
  );
}

function AppIcon({ name, iconUrl }: { name: string; iconUrl: string | null }) {
  const [failed, setFailed] = useState(false);

  if (iconUrl && !failed) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="size-6 rounded shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="size-6 rounded bg-foreground/10 text-foreground/50 flex items-center justify-center text-xs font-medium shrink-0">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function RecentReleases() {
  const [items, setItems] = useState<RecentRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE_URL}/v1/releases/recent`)
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json() as Promise<{ items: RecentRelease[] }>;
      })
      .then((data) => {
        setItems(data.items);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []);

  if (error || (!loading && items.length === 0)) {
    return null;
  }

  return (
    <section className="space-y-5 mt-8">
      <h2 className="text-sm font-medium text-muted-foreground">Latest Updates</h2>
      <div className="relative">
        {loading ? (
          <SkeletonRows />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li
                key={item.releaseId}
                className="flex items-center gap-2.5 text-[13px] leading-none select-none"
              >
                <AppIcon name={item.appName} iconUrl={item.iconUrl} />
                <span className="text-foreground truncate">{item.appName}</span>
                <span className="text-muted-foreground font-mono text-[11px] leading-none">
                  {item.version}
                </span>
                <span className="ml-auto text-muted-foreground/60 text-xs whitespace-nowrap">
                  {formatRelativeTime(item.releasedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-48"
          style={{
            background: "linear-gradient(to bottom, transparent, var(--background))",
          }}
        />
      </div>
    </section>
  );
}
