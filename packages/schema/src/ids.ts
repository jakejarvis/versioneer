import { customAlphabet } from "nanoid";

// Using a custom alphabet without ambiguous characters
const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const generate = customAlphabet(alphabet, 20);

export function generateId(prefix: string): string {
  return `${prefix}_${generate()}`;
}

export const idPrefixes = {
  app: "app",
  alias: "alias",

  source: "src",
  sourceFetch: "fetch",
  parserRun: "parse",
  release: "rel",
  releaseObservation: "obs",
  artifact: "art",
  appLatestRelease: "alr",
  client: "cli",
  clientInventorySnapshot: "snap",
  clientInventoryApp: "cia",
  jobFailure: "jf",
  auditLog: "al",
  feedback: "fb",
  updateExecution: "exec",
  discoveredApp: "dapp",
  cronJobRun: "cjr",
} as const;
