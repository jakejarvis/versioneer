import { createFileRoute } from "@tanstack/react-router";

import { SourcesTab, useAppDetailPageContext } from "./$appId";

export const Route = createFileRoute("/apps/$appId/sources")({
  component: AppSourcesRoute,
});

function AppSourcesRoute() {
  const { appId } = useAppDetailPageContext();
  return <SourcesTab appId={appId} />;
}
