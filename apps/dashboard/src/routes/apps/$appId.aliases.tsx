import { createFileRoute } from "@tanstack/react-router";

import { AliasesTab, useAppDetailPageContext } from "./$appId";

export const Route = createFileRoute("/apps/$appId/aliases")({
  component: AppAliasesRoute,
});

function AppAliasesRoute() {
  const { appId } = useAppDetailPageContext();
  return <AliasesTab appId={appId} />;
}
