import { createFileRoute } from "@tanstack/react-router";

import { SourcesTab } from "./$appId";

export const Route = createFileRoute("/apps/$appId/sources")({
  component: AppSourcesRoute,
});

function AppSourcesRoute() {
  const { appId } = Route.useParams();
  return <SourcesTab appId={appId} />;
}
