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
  catalogSuggestion: "sug",
  suggestionEvidence: "sev",
  trustAssertion: "tas",
  installExecution: "exec",

  source: "src",
  sourceFetch: "fetch",
  parserRun: "parse",
  release: "rel",
  releaseObservation: "obs",
  artifact: "art",
  appLatestRelease: "alr",
  jobFailure: "jf",
  auditLog: "al",
  feedback: "fb",
  discoveredApp: "dapp",
  inventorySubmission: "invsub",
  inventoryIconUpload: "iup",
  inventoryIngestionJob: "ing",
  cronJobRun: "cjr",
} as const;
