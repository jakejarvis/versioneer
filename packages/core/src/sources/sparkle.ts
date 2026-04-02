import { defaultDescriptor } from "./default";
import type { SourceTypeDescriptor } from "./types";

export const sparkleDescriptor: SourceTypeDescriptor = {
  ...defaultDescriptor,
  derivedAlias: (baseUrl) => ({ aliasType: "sparkle_feed", value: baseUrl }),
};
