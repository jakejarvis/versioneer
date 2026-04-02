import { defaultDescriptor } from "./default";
import type { SourceTypeDescriptor } from "./types";

export const homebrewCaskDescriptor: SourceTypeDescriptor = {
  ...defaultDescriptor,

  resolveUrl: (identifier) =>
    `https://formulae.brew.sh/api/cask/${encodeURIComponent(identifier)}.json`,

  extractIdentifier(baseUrl) {
    const match = /formulae\.brew\.sh\/api\/cask\/([^.]+)\.json/.exec(baseUrl);
    return match?.[1] ? decodeURIComponent(match[1]) : baseUrl;
  },
};
