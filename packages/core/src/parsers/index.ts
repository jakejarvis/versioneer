export type { ParsedRelease, ParsedArtifact, ParserOutput, SourceParser } from "./types";
export { registerParser, getParser, listParsers } from "./registry";
export { sparkleParser } from "./sparkle";
export { githubReleasesParser } from "./github";
export { homebrewCaskParser } from "./homebrew-cask";
export { macAppStoreParser } from "./mac-app-store";
export { electronGenericParser } from "./electron-generic";
export { webPageParser } from "./web-page";

import { electronGenericParser } from "./electron-generic";
// Auto-register built-in parsers
import { githubReleasesParser } from "./github";
import { homebrewCaskParser } from "./homebrew-cask";
import { macAppStoreParser } from "./mac-app-store";
import { registerParser } from "./registry";
import { sparkleParser } from "./sparkle";
import { webPageParser } from "./web-page";

registerParser(sparkleParser);
registerParser(githubReleasesParser);
registerParser(homebrewCaskParser);
registerParser(macAppStoreParser);
registerParser(electronGenericParser);
registerParser(webPageParser);
