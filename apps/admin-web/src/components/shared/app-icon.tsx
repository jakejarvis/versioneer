import { cn } from "@/lib/utils";

const ASSETS_BASE_URL = import.meta.env.VITE_ASSETS_BASE_URL ?? "";

interface AppIconProps {
  iconR2Key: string | null;
  appName: string;
  size?: number;
  className?: string;
}

export function AppIcon({ iconR2Key, appName, size = 32, className }: AppIconProps) {
  if (iconR2Key) {
    return (
      <img
        src={`${ASSETS_BASE_URL}/${iconR2Key}`}
        alt={`${appName} icon`}
        width={size}
        height={size}
        className={cn("rounded-md object-contain", className)}
      />
    );
  }

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
