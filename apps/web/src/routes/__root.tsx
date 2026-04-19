import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";

import { NotFound } from "@/components/not-found";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";

import "@/styles/app.css";

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <TooltipProvider>
      <div className="mx-auto max-w-xl px-6 py-16 sm:py-20 md:py-28 space-y-10">
        <header className="flex items-center justify-between gap-2.5 text-white">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/versioneer-96x96.png" alt="Versioneer" className="size-6 rounded-sm" />
            <h1 className="font-mono font-medium">Versioneer.app</h1>
          </Link>
          <nav className="flex items-center gap-3.5 h-5">
            <Link
              to="/changelog"
              className="text-[13px] text-foreground/70 hover:text-foreground transition-colors"
            >
              Changelog
            </Link>
            <Separator orientation="vertical" />
            <a
              href="https://github.com/jakejarvis/versioneer"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/80 hover:text-foreground transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="size-5">
                <path
                  fill="currentColor"
                  d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436c.55.096.756-.233.756-.522c0-.262-.013-1.128-.013-2.049c-2.764.509-3.479-.674-3.699-1.292c-.124-.317-.66-1.293-1.127-1.554c-.385-.207-.936-.715-.014-.729c.866-.014 1.485.797 1.691 1.128c.99 1.663 2.571 1.196 3.204.907c.096-.715.385-1.196.701-1.471c-2.448-.275-5.005-1.224-5.005-5.432c0-1.196.426-2.186 1.128-2.956c-.111-.275-.496-1.402.11-2.915c0 0 .921-.288 3.024 1.128a10.2 10.2 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371c2.104-1.43 3.025-1.128 3.025-1.128c.605 1.513.221 2.64.111 2.915c.701.77 1.127 1.747 1.127 2.956c0 4.222-2.571 5.157-5.019 5.432c.399.344.743 1.004.743 2.035c0 1.471-.014 2.654-.014 3.025c0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11"
                />
              </svg>
            </a>
          </nav>
        </header>

        <Outlet />

        <footer className="text-xs text-muted-foreground border-t border-foreground/10 pt-6">
          <p>
            Created by{" "}
            <a
              href="https://jarv.is"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 underline hover:text-foreground"
            >
              @jakejarvis
              <ArrowUpRightIcon className="size-3.5 inline-block -translate-y-px ml-0.5" />
            </a>
          </p>
        </footer>
      </div>
    </TooltipProvider>
  );
}
