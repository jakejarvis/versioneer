import { afterEach, beforeEach, vi } from "vitest";

function describeFetchInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return "unknown URL";
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      throw new Error(
        `Unexpected network request in test: ${describeFetchInput(input)}. Mock globalThis.fetch in the test.`,
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
