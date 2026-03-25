import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { appsIndexRoute } from "./routes/apps/index";
import { appDetailRoute } from "./routes/apps/$appId";
import { sourcesIndexRoute } from "./routes/sources/index";
import { sourceDetailRoute } from "./routes/sources/$sourceId";
import { releasesIndexRoute } from "./routes/releases/index";
import { releaseDetailRoute } from "./routes/releases/$releaseId";
import { reviewQueueIndexRoute } from "./routes/review-queue/index";
import { jobFailuresIndexRoute } from "./routes/job-failures/index";
import { overridesIndexRoute } from "./routes/overrides/index";
import { auditLogIndexRoute } from "./routes/audit-log/index";

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
