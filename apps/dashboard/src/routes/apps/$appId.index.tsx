import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/hooks/use-apps";

import { OverviewTab } from "./$appId";

export const Route = createFileRoute("/apps/$appId/")({
  component: AppOverviewRoute,
});

function AppOverviewRoute() {
  const { appId } = Route.useParams();
  const { data: app, isLoading } = useApp(appId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!app) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyDescription>App not found.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <OverviewTab appId={appId} app={app} />;
}
