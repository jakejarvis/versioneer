export type { ParsedRelease, ParsedArtifact, ParserOutput, SourceParser } from "./types";
export { registerParser, getParser, listParsers } from "./registry";
export { sparkleParser } from "./sparkle";
export { githubReleasesParser } from "./github";
export { homebrewCaskParser } from "./homebrew-cask";
export { macAppStoreParser } from "./mac-app-store";
export { electronGenericParser } from "./electron-generic";
export { webPageParser } from "./web-page";
export { regexParser } from "./regex";
export { jsonParser } from "./json";
export { xmlParser } from "./xml";

import { electronGenericParser } from "./electron-generic";
// Auto-register built-in parsers
import { githubReleasesParser } from "./github";
import { homebrewCaskParser } from "./homebrew-cask";
import { jsonParser } from "./json";
import { macAppStoreParser } from "./mac-app-store";
import { regexParser } from "./regex";
import { registerParser } from "./registry";
import { sparkleParser } from "./sparkle";
import { webPageParser } from "./web-page";
import { xmlParser } from "./xml";

registerParser(sparkleParser);
registerParser(githubReleasesParser);
registerParser(homebrewCaskParser);
registerParser(macAppStoreParser);
registerParser(electronGenericParser);
registerParser(webPageParser);
registerParser(regexParser);
registerParser(jsonParser);
registerParser(xmlParser);
