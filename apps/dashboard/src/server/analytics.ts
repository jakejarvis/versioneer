import { env } from "cloudflare:workers";

import {
  captureServerEvent,
  captureServerException,
  type ObservabilityProperties,
} from "@versioneer/core/observability";

interface AdminActor {
  id: string;
}

export function captureAdminEvent(
  actor: AdminActor,
  event: string,
  properties: ObservabilityProperties = {},
) {
  return captureServerEvent(env, {
    distinctId: actor.id,
    event,
    properties: {
      surface: "dashboard",
      actor_id: actor.id,
      ...properties,
    },
  });
}

export function captureAdminException(
  actor: AdminActor,
  error: unknown,
  properties: ObservabilityProperties = {},
) {
  return captureServerException(env, {
    distinctId: actor.id,
    error,
    properties: {
      surface: "dashboard",
      actor_id: actor.id,
      ...properties,
    },
  });
}
