import { AlertTriangle, Home, RotateCcw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function errorMessage(error: unknown) {
  if (error instanceof Response) return `${error.status} ${error.statusText}`.trim();
  if (error instanceof Error) return error.message;
  return "The dashboard could not load this view.";
}

export function DashboardRouteError({ error, reset }: { error: unknown; reset?: () => void }) {
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
