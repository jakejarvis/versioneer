import { createFileRoute } from "@tanstack/react-router";

import { AliasesTab } from "./$appId";

export const Route = createFileRoute("/apps/$appId/aliases")({
  component: AppAliasesRoute,
});

function AppAliasesRoute() {
  const { appId } = Route.useParams();
  return <AliasesTab appId={appId} />;
}
