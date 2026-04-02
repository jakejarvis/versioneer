import { defaultDescriptor } from "./default";
import {
  buildElectronFeedCandidates,
  canonicalizeElectronBaseUrl,
  resolveElectronArtifactBase,
} from "./electron-url";
import type { SourceTypeDescriptor } from "./types";

export const electronGenericDescriptor: SourceTypeDescriptor = {
  ...defaultDescriptor,

  resolveUrl: canonicalizeElectronBaseUrl,

  buildFetchUrls: buildElectronFeedCandidates,
  resolveArtifactBase: resolveElectronArtifactBase,

  derivedAlias: (baseUrl) => ({ aliasType: "electron_update_url", value: baseUrl }),
};
