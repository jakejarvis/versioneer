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
    expect(paginationSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("rejects limit above 100", () => {
    expect(paginationSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("rejects negative offset", () => {
    expect(paginationSchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("rejects non-integer values", () => {
    expect(paginationSchema.safeParse({ limit: 1.5 }).success).toBe(false);
  });
});

describe("idParamSchema", () => {
  it("parses a valid ID", () => {
    const result = idParamSchema.parse({ id: "app_abc123" });
    expect(result.id).toBe("app_abc123");
  });

  it("rejects empty ID", () => {
    expect(idParamSchema.safeParse({ id: "" }).success).toBe(false);
  });
});

describe("channelSchema", () => {
  it("accepts lowercase alphanumeric with hyphens and underscores", () => {
    expect(channelSchema.parse("stable")).toBe("stable");
    expect(channelSchema.parse("beta-1")).toBe("beta-1");
    expect(channelSchema.parse("nightly_build")).toBe("nightly_build");
  });

  it("rejects uppercase characters", () => {
    expect(channelSchema.safeParse("Beta").success).toBe(false);
  });

  it("rejects spaces", () => {
    expect(channelSchema.safeParse("my channel").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(channelSchema.safeParse("").success).toBe(false);
  });

  it("rejects special characters", () => {
    expect(channelSchema.safeParse("beta.1").success).toBe(false);
    expect(channelSchema.safeParse("beta/1").success).toBe(false);
  });

  it("rejects strings over 50 characters", () => {
    expect(channelSchema.safeParse("a".repeat(51)).success).toBe(false);
  });
});
