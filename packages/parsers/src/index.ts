export type { ParsedRelease, ParsedArtifact, ParserOutput, SourceParser } from "./types";
export { registerParser, getParser, listParsers } from "./registry";
export { sparkleParser } from "./sparkle";
export { githubReleasesParser } from "./github";

// Auto-register built-in parsers
import { registerParser } from "./registry";
import { sparkleParser } from "./sparkle";
import { githubReleasesParser } from "./github";

registerParser(sparkleParser);
registerParser(githubReleasesParser);
