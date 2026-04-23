import { createFileRoute } from "@tanstack/react-router";
import posthogClient from "posthog-js";

import { RecentReleases } from "@/components/recent-releases";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getPageSeoHead } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () =>
    getPageSeoHead({
      title: "Versioneer — Free & open-source macOS app updater",
      description:
        "Versioneer is a modern macOS app updater focused on broad compatibility, privacy-friendly crowdsourcing, and safe one-click installs.",
      path: "/",
    }),
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

      <section>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className="cursor-wait rounded-full" size="lg" asChild>
              <a
                // href="https://dl.versioneer.app/latest/Versioneer.zip"
                onClick={() => posthogClient.capture("marketing_download_clicked")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-4">
                  <path
                    fill="currentColor"
                    d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04c-2.04.027-3.91 1.183-4.961 3.014c-2.117 3.675-.546 9.103 1.519 12.09c1.013 1.454 2.208 3.09 3.792 3.039c1.52-.065 2.09-.987 3.935-.987c1.831 0 2.35.987 3.96.948c1.637-.026 2.676-1.48 3.676-2.948c1.156-1.688 1.636-3.325 1.662-3.415c-.039-.013-3.182-1.221-3.22-4.857c-.026-3.04 2.48-4.494 2.597-4.559c-1.429-2.09-3.623-2.324-4.39-2.376c-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83c-1.207.052-2.662.805-3.532 1.818c-.78.896-1.454 2.338-1.273 3.714c1.338.104 2.715-.688 3.559-1.701"
                  />
                </svg>
                Download for Mac
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Coming soon™</TooltipContent>
        </Tooltip>
      </section>

      <RecentReleases />
    </main>
  );
}
