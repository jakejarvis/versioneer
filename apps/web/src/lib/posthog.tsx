import { PostHogProvider } from "@posthog/react";
import posthogClient from "posthog-js";
import type { PostHogConfig, Properties } from "posthog-js";
import type { ReactNode } from "react";

const posthogProjectToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

const posthogOptions: Partial<PostHogConfig> = {
  api_host: posthogHost,
  defaults: "2026-01-30",
  capture_exceptions: true,
  capture_pageview: "history_change",
  autocapture: false,
};

export function WebPostHogProvider({ children }: { children: ReactNode }) {
  if (!posthogProjectToken) return <>{children}</>;

  return (
    <PostHogProvider apiKey={posthogProjectToken} options={posthogOptions}>
      {children}
    </PostHogProvider>
  );
}

export function captureMarketingEvent(event: string, properties: Properties = {}) {
  if (!posthogProjectToken) return;
  posthogClient.capture(event, {
    surface: "web",
    ...properties,
  });
}

export function captureMarketingException(error: unknown, properties: Properties = {}) {
  if (!posthogProjectToken) return;
  posthogClient.captureException(error, {
    surface: "web",
    ...properties,
  });
}
