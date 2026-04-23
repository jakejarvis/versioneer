import { createFileRoute } from "@tanstack/react-router";

import { ReleasesTab, useAppDetailPageContext } from "./$appId";

export const Route = createFileRoute("/apps/$appId/releases")({
  component: AppReleasesRoute,
});

function AppReleasesRoute() {
  const { appId } = useAppDetailPageContext();
  return <ReleasesTab appId={appId} />;
}
