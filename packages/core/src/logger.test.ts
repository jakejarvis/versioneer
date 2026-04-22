import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createLogger } from "./logger";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits structured console attributes", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger({ component: "worker" });

    logger.info("source fetched", { sourceId: "src-1" });

    expect(info).toHaveBeenCalledWith(
      "source fetched",
      expect.objectContaining({
        component: "worker",
        level: "info",
        sourceId: "src-1",
        ts: expect.any(String),
      }),
    );
  });

  it("flattens Error objects without logging stacks", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ component: "api" });

    logger.error("request failed", { error: new TypeError("bad request") });

    expect(errorSpy).toHaveBeenCalledWith(
      "request failed",
      expect.objectContaining({
        component: "api",
        errorMessage: "bad request",
        errorName: "TypeError",
        level: "error",
      }),
    );
  });
});
