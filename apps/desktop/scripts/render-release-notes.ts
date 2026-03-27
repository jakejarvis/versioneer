import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderReleaseNotesDocument } from "../../../packages/pipeline/src/release-notes";

interface CliArgs {
  input: string;
  output: string;
  title: string;
}

const args = parseArgs(process.argv.slice(2));
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const body = await readFile(args.input, "utf8").catch(() => "");
  const html = renderReleaseNotesDocument(body, "markdown", args.title);

  await mkdir(path.dirname(args.output), { recursive: true });
  await writeFile(args.output, html);
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<CliArgs> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--input" && value) {
      values.input = value;
      index += 1;
    } else if (arg === "--output" && value) {
      values.output = value;
      index += 1;
    } else if (arg === "--title" && value) {
      values.title = value;
      index += 1;
    }
  }

  if (!values.input || !values.output || !values.title) {
    throw new Error(
      "Usage: render-release-notes.ts --input <path> --output <path> --title <title>",
    );
  }

  return values as CliArgs;
}
