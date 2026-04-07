import { describe, expect, it } from "vitest";

import { channelSchema, idParamSchema, paginationSchema } from "../common";

describe("paginationSchema", () => {
  it("applies defaults when empty", () => {
    const result = paginationSchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it("coerces string values to numbers", () => {
    const result = paginationSchema.parse({ limit: "25", offset: "10" });
    expect(result.limit).toBe(25);
    expect(result.offset).toBe(10);
  });

  it("rejects limit below 1", () => {
    expect(() => paginationSchema.parse({ limit: 0 })).toThrow();
  });

  it("rejects limit above 100", () => {
    expect(() => paginationSchema.parse({ limit: 101 })).toThrow();
  });

  it("rejects negative offset", () => {
    expect(() => paginationSchema.parse({ offset: -1 })).toThrow();
  });

  it("rejects non-integer values", () => {
    expect(() => paginationSchema.parse({ limit: 1.5 })).toThrow();
  });
});

describe("idParamSchema", () => {
  it("parses a valid ID", () => {
    const result = idParamSchema.parse({ id: "app_abc123" });
    expect(result.id).toBe("app_abc123");
  });

  it("rejects empty ID", () => {
    expect(() => idParamSchema.parse({ id: "" })).toThrow();
  });
});

describe("channelSchema", () => {
  it("accepts lowercase alphanumeric with hyphens and underscores", () => {
    expect(channelSchema.parse("stable")).toBe("stable");
    expect(channelSchema.parse("beta-1")).toBe("beta-1");
    expect(channelSchema.parse("nightly_build")).toBe("nightly_build");
  });

  it("rejects uppercase characters", () => {
    expect(() => channelSchema.parse("Beta")).toThrow();
  });

  it("rejects spaces", () => {
    expect(() => channelSchema.parse("my channel")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => channelSchema.parse("")).toThrow();
  });

  it("rejects special characters", () => {
    expect(() => channelSchema.parse("beta.1")).toThrow();
    expect(() => channelSchema.parse("beta/1")).toThrow();
  });

  it("rejects strings over 50 characters", () => {
    expect(() => channelSchema.parse("a".repeat(51))).toThrow();
  });
});
