export type { ParsedRelease, ParsedArtifact, ParserOutput, SourceParser } from "./types";
export { registerParser, getParser, listParsers } from "./registry";
export { sparkleParser } from "./sparkle";
export { githubReleasesParser } from "./github";

// Auto-register built-in parsers
import { githubReleasesParser } from "./github";
import { registerParser } from "./registry";
import { sparkleParser } from "./sparkle";

registerParser(sparkleParser);
registerParser(githubReleasesParser);
