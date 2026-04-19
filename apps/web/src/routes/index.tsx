import { createFileRoute } from "@tanstack/react-router";
import { HardDriveDownloadIcon } from "lucide-react";

import { RecentReleases } from "@/components/recent-releases";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <main className="space-y-6">
      <p className="prose">
        A modern replacement for{" "}
        <a href="https://www.corecode.io/macupdater/" target="_blank" rel="noopener noreferrer">
          MacUpdater
        </a>{" "}
        <span className="text-muted-foreground">(RIP)</span> focused on widespread app
        compatibility, privacy-friendly data crowdsourcing, and safe one-click installs, all behind
        a beautiful, fast, and native UI.
      </p>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              // href="https://dl.versioneer.app/latest/Versioneer.zip"
              className="cursor-not-allowed text-foreground hover:text-foreground/80 inline-flex items-center gap-2 underline-offset-4 underline text-sm"
            >
              <HardDriveDownloadIcon className="size-3 text-foreground" />
              Download
            </span>
          </TooltipTrigger>
          <TooltipContent>Coming soon™</TooltipContent>
        </Tooltip>
      </div>

      <RecentReleases />
    </main>
  );
}
