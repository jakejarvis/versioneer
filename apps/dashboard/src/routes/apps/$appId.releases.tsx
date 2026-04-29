import { createFileRoute } from "@tanstack/react-router";

import { ReleasesTab } from "./$appId";

export const Route = createFileRoute("/apps/$appId/releases")({
  component: AppReleasesRoute,
});

function AppReleasesRoute() {
  const { appId } = Route.useParams();
  return <ReleasesTab appId={appId} />;
}
