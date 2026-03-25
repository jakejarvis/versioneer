import type { SourceParser } from "./types";

const parsers = new Map<string, SourceParser>();

export function registerParser(parser: SourceParser): void {
  parsers.set(parser.key, parser);
}

export function getParser(key: string): SourceParser | undefined {
  return parsers.get(key);
}

export function listParsers(): string[] {
  return [...parsers.keys()];
}
