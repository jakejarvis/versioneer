import { createFileRoute } from "@tanstack/react-router";

import { OverviewTab, useAppDetailPageContext } from "./$appId";

export const Route = createFileRoute("/apps/$appId/")({
  component: AppOverviewRoute,
});

function AppOverviewRoute() {
  const { appId, app } = useAppDetailPageContext();
  return <OverviewTab appId={appId} app={app} />;
}
