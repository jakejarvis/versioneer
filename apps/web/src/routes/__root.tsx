import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

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
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: SITE_NAME },
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

function RootComponent() {
  return (
    <>
      <HeadContent />
      <TooltipProvider>
        <AppLayout />
      </TooltipProvider>
      <Scripts />
    </>
  );
}
