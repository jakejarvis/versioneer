import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { captureDashboardException } from "@/lib/posthog";

function errorMessage(error: unknown) {
  if (error instanceof Response) return `${error.status} ${error.statusText}`.trim();
  if (error instanceof Error) return error.message;
  return "The dashboard could not load this view.";
}

export function DashboardRouteError({ error, reset }: { error: unknown; reset?: () => void }) {
  useEffect(() => {
    captureDashboardException(error, {
      component: "dashboard_route_error",
      status: error instanceof Response ? error.status : undefined,
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col justify-center gap-4">
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Dashboard view failed</AlertTitle>
        <AlertDescription>{errorMessage(error)}</AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <a href="/">
            <Home data-icon="inline-start" />
            Back to dashboard
          </a>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            reset?.();
            window.location.reload();
          }}
        >
          <RotateCcw data-icon="inline-start" />
          Reload
        </Button>
      </div>
    </div>
  );
}
