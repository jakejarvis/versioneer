import { rootRoute } from "./routes/__root";
import { appDetailRoute } from "./routes/apps/$appId";
import { appsIndexRoute } from "./routes/apps/index";
import { auditLogIndexRoute } from "./routes/audit-log/index";
import { indexRoute } from "./routes/index";
import { jobFailuresIndexRoute } from "./routes/job-failures/index";
import { overridesIndexRoute } from "./routes/overrides/index";
import { releaseDetailRoute } from "./routes/releases/$releaseId";
import { releasesIndexRoute } from "./routes/releases/index";
import { reviewQueueIndexRoute } from "./routes/review-queue/index";
import { sourceDetailRoute } from "./routes/sources/$sourceId";
import { sourcesIndexRoute } from "./routes/sources/index";

export const routeTree = rootRoute.addChildren([
  indexRoute,
  appsIndexRoute,
  appDetailRoute,
  sourcesIndexRoute,
  sourceDetailRoute,
  releasesIndexRoute,
  releaseDetailRoute,
  reviewQueueIndexRoute,
  jobFailuresIndexRoute,
  overridesIndexRoute,
  auditLogIndexRoute,
]);
