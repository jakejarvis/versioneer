import { Shield, ShieldCheck, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";

const tierConfig: Record<string, { icon: typeof Shield; color: string; label: string }> = {
  verified: {
    icon: ShieldCheck,
    color: "text-emerald-600 dark:text-emerald-400",
    label: "Verified",
  },
  provisional: { icon: Shield, color: "text-blue-600 dark:text-blue-400", label: "Provisional" },
  unverified: { icon: ShieldAlert, color: "text-zinc-400 dark:text-zinc-500", label: "Unverified" },
};

export function VerificationBadge({ tier, className }: { tier: string; className?: string }) {
  const config = tierConfig[tier] ?? tierConfig.unverified!;
  const Icon = config.icon;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs font-medium", config.color, className)}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}
