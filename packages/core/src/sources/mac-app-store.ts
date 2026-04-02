import { defaultDescriptor } from "./default";
import type { SourceTypeDescriptor } from "./types";

export const macAppStoreDescriptor: SourceTypeDescriptor = {
  ...defaultDescriptor,

  resolveUrl: (identifier) =>
    `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(identifier)}&country=us`,

  extractIdentifier(baseUrl) {
    const match = /[?&]bundleId=([^&]+)/.exec(baseUrl);
    return match?.[1] ? decodeURIComponent(match[1]) : baseUrl;
  },
};
