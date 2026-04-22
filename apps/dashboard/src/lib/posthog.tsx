import { PostHogProvider } from "@posthog/react";
import posthogClient from "posthog-js";
import type { PostHogConfig, Properties } from "posthog-js";
import { type ReactNode, useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";

const posthogProjectToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

const posthogOptions: Partial<PostHogConfig> = {
  api_host: posthogHost,
  defaults: "2026-01-30",
  capture_exceptions: true,
  capture_pageview: "history_change",
  autocapture: false,
};

export function DashboardPostHogProvider({ children }: { children: ReactNode }) {
  if (!posthogProjectToken) return <>{children}</>;

  return (
    <PostHogProvider apiKey={posthogProjectToken} options={posthogOptions}>
      {children}
    </PostHogProvider>
  );
}

export function DashboardPostHogIdentity() {
  const { data: user, isSuccess } = useAuth();

  useEffect(() => {
    if (!posthogProjectToken || !isSuccess) return;

    if (user) {
      posthogClient.identify(user.id, {
        email: user.email,
        name: user.name ?? undefined,
      });
    } else {
      posthogClient.reset();
    }
  }, [isSuccess, user]);

  return null;
}

export function captureDashboardEvent(event: string, properties: Properties = {}) {
  if (!posthogProjectToken) return;
  posthogClient.capture(event, {
    surface: "dashboard",
    ...properties,
  });
}

export function captureDashboardException(error: unknown, properties: Properties = {}) {
  if (!posthogProjectToken) return;
  posthogClient.captureException(error, {
    surface: "dashboard",
    ...properties,
  });
}

export function resetDashboardPostHog() {
  if (!posthogProjectToken) return;
  posthogClient.reset();
}
