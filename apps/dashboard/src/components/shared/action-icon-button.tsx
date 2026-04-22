import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function ActionIconButton({
  label,
  icon: Icon,
  variant = "ghost",
  size = "icon",
  disabled,
  onClick,
  children,
  asChild,
}: {
  label: string;
  icon: LucideIcon;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  asChild?: boolean;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            asChild={asChild}
          >
            {children ?? <Icon data-icon="inline-start" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
