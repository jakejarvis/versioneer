import { defaultDescriptor } from "./default";
import type { SourceTypeDescriptor } from "./types";

export const manualDescriptor: SourceTypeDescriptor = {
  ...defaultDescriptor,
  resolveUrl: () => null,
  skipsFetch: true,
  buildFetchUrls: () => [],
};
