import { useState } from "react";

import { cn } from "@/lib/utils";

interface AppIconProps {
  iconR2Key: string | null;
  /** Full resolved URL — pass this instead of iconR2Key when the server has already built the URL. */
  iconUrl?: string | null;
  appName: string;
  size?: number;
  className?: string;
}

function Initials({
  appName,
  size,
  className,
}: {
  appName: string;
  size: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {appName.charAt(0).toUpperCase()}
    </div>
  );
}

export function AppIcon({ iconR2Key, iconUrl, appName, size = 32, className }: AppIconProps) {
  const src = iconUrl ?? (iconR2Key ? `/api/assets/${iconR2Key}` : null);
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={`${appName} icon`}
        width={size}
        height={size}
        className={cn("rounded-md object-contain", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return <Initials appName={appName} size={size} className={className} />;
}
