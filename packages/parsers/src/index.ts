export type { ParsedRelease, ParsedArtifact, ParserOutput, SourceParser } from "./types";
export { registerParser, getParser, listParsers } from "./registry";
export { sparkleParser } from "./sparkle";
export { githubReleasesParser } from "./github";
export { homebrewCaskParser } from "./homebrew-cask";

// Auto-register built-in parsers
import { githubReleasesParser } from "./github";
import { homebrewCaskParser } from "./homebrew-cask";
import { registerParser } from "./registry";
import { sparkleParser } from "./sparkle";

registerParser(sparkleParser);
registerParser(githubReleasesParser);
registerParser(homebrewCaskParser);
