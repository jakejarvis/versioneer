import { PostHogProvider } from "@posthog/react";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { PostHogConfig } from "posthog-js";

import { AppLayout } from "@/components/layout";
import { NotFound } from "@/components/not-found";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE_NAME } from "@/lib/seo";

import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { title: SITE_NAME },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { name: "robots", content: "index, follow" },
      { name: "theme-color", content: "#000000" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  notFoundComponent: NotFound,
});

const posthogOptions: Partial<PostHogConfig> = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: true,
  capture_pageview: "history_change",
  autocapture: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_external_dependency_loading: true,
  person_profiles: "never",
};

function RootComponent() {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <HeadContent />
      </head>
      <body>
        <PostHogProvider
          apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!}
          options={posthogOptions}
        >
          <TooltipProvider>
            <AppLayout />
          </TooltipProvider>
        </PostHogProvider>
        <Scripts />
      </body>
    </html>
  );
}
