import {
  defaultRoleForSourceType,
  type SourceRole,
  type SourceType,
} from "@versioneer/schemas/sources";

export function validateSourceReorderInput(params: {
  appSourceIds: readonly string[];
  requestedSourceIds: readonly string[];
}): string | null {
  const { appSourceIds, requestedSourceIds } = params;

  if (requestedSourceIds.length !== appSourceIds.length) {
    return "Source reorder must include every app source exactly once";
  }

  const requestedIds = new Set<string>();
  for (const sourceId of requestedSourceIds) {
    if (requestedIds.has(sourceId)) {
      return "Source reorder contains duplicate source IDs";
    }
    requestedIds.add(sourceId);
  }

  const appSourceIdSet = new Set(appSourceIds);
  for (const sourceId of requestedSourceIds) {
    if (!appSourceIdSet.has(sourceId)) {
      return `Source ${sourceId} does not belong to app`;
    }
  }

  return null;
}

export interface ReorderableSource {
  id: string;
  sourceType: SourceType;
  channel: string | null;
}

export function computeReorderedSourceRoles(params: {
  sources: readonly ReorderableSource[];
  requestedSourceIds: readonly string[];
}): Map<string, SourceRole> {
  const sourceById = new Map(params.sources.map((source) => [source.id, source] as const));
  const authorityAssignedChannels = new Set<string>();
  const roleById = new Map<string, SourceRole>();

  for (const sourceId of params.requestedSourceIds) {
    const source = sourceById.get(sourceId);
    if (!source) continue;

    const defaultRole = defaultRoleForSourceType(source.sourceType);
    if (defaultRole !== "authority") {
      roleById.set(sourceId, defaultRole);
      continue;
    }

    const channelKey = source.channel ?? "__default__";
    if (authorityAssignedChannels.has(channelKey)) {
      roleById.set(sourceId, "corroborating");
      continue;
    }

    authorityAssignedChannels.add(channelKey);
    roleById.set(sourceId, "authority");
  }

  return roleById;
}
