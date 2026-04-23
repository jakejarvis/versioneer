import { PostHogProvider } from "@posthog/react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import posthogClient from "posthog-js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RouteError } from "@/components/route-error";

import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  defaultErrorComponent: RouteError,
  defaultPreload: "intent",
  scrollRestoration: true,
});

posthogClient.init(import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: true,
  capture_pageview: "history_change",
  autocapture: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_external_dependency_loading: true,
  person_profiles: "never",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PostHogProvider client={posthogClient}>
      <RouterProvider router={router} />
    </PostHogProvider>
  </StrictMode>,
);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
