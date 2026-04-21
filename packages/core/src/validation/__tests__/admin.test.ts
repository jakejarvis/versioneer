import { describe, expect, it } from "vite-plus/test";

import {
  aliasCreateSchema,
  aliasUpdateSchema,
  appCreateSchema,
  appUpdateSchema,
  releaseCreateSchema,
  releasePinSchema,
  releaseUpdateSchema,
  sourceCreateSchema,
  sourceUpdateSchema,
} from "../admin";

describe("appCreateSchema", () => {
  it("parses a valid app", () => {
    const result = appCreateSchema.parse({
      slug: "visual-studio-code",
      canonicalName: "Visual Studio Code",
    });
    expect(result.slug).toBe("visual-studio-code");
  });

  it("rejects uppercase slugs", () => {
    expect(appCreateSchema.safeParse({ slug: "Foo-Bar", canonicalName: "Foo" }).success).toBe(
      false,
    );
  });

  it("rejects slugs with spaces", () => {
    expect(appCreateSchema.safeParse({ slug: "foo bar", canonicalName: "Foo" }).success).toBe(
      false,
    );
  });

  it("rejects empty slug", () => {
    expect(appCreateSchema.safeParse({ slug: "", canonicalName: "Foo" }).success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = appCreateSchema.parse({
      slug: "foo",
      canonicalName: "Foo",
      vendorName: "Foo Inc",
      homepageUrl: "https://foo.com",
      notes: "Some notes",
    });
    expect(result.vendorName).toBe("Foo Inc");
    expect(result.homepageUrl).toBe("https://foo.com");
  });

  it("rejects invalid URL for homepageUrl", () => {
    expect(
      appCreateSchema.safeParse({ slug: "foo", canonicalName: "Foo", homepageUrl: "not-a-url" })
        .success,
    ).toBe(false);
  });
});

describe("appUpdateSchema", () => {
  it("parses valid status values", () => {
    for (const status of ["draft", "public", "merged", "deprecated", "unlisted"]) {
      const result = appUpdateSchema.parse({ status });
      expect(result.status).toBe(status);
    }
  });

  it("accepts nullable fields", () => {
    const result = appUpdateSchema.parse({ vendorName: null, homepageUrl: null });
    expect(result.vendorName).toBeNull();
  });
});

describe("aliasCreateSchema", () => {
  it("parses a valid alias with defaults", () => {
    const result = aliasCreateSchema.parse({ aliasType: "bundle_id", value: "com.example.app" });
    expect(result.isExact).toBe(true);
    expect(result.priority).toBe(0);
    expect(result.confidenceWeight).toBe(100);
  });

  it("accepts all alias types", () => {
    const types = [
      "bundle_id",
      "name",
      "team_id",
      "sparkle_feed",
      "homepage",
      "download_pattern",
      "github_repo",
      "mas_app_id",
      "electron_update_url",
      "homebrew_cask",
    ];
    for (const aliasType of types) {
      expect(() => aliasCreateSchema.parse({ aliasType, value: "test" })).not.toThrow();
    }
  });

  it("rejects confidenceWeight over 100", () => {
    expect(
      aliasCreateSchema.safeParse({
        aliasType: "bundle_id",
        value: "test",
        confidenceWeight: 101,
      }).success,
    ).toBe(false);
  });
});

describe("aliasUpdateSchema", () => {
  it("parses valid update", () => {
    const result = aliasUpdateSchema.parse({ isActive: false, priority: 5 });
    expect(result.isActive).toBe(false);
  });
});

describe("sourceCreateSchema", () => {
  it("parses a valid source with defaults", () => {
    const result = sourceCreateSchema.parse({
      appId: "app_123",
      sourceType: "github_releases",
      parserKey: "github_releases",
    });
    expect(result.pollIntervalMinutes).toBe(60);
    expect(result.reviewStatus).toBe("pending");
  });

  it("rejects pollIntervalMinutes below 5", () => {
    expect(
      sourceCreateSchema.safeParse({
        appId: "app_123",
        sourceType: "sparkle",
        parserKey: "sparkle",
        pollIntervalMinutes: 1,
      }).success,
    ).toBe(false);
  });

  it("accepts all source types", () => {
    const types = [
      "sparkle",
      "github_releases",
      "manual",
      "homebrew_cask",
      "mac_app_store",
      "electron_generic",
      "web_page",
      "regex",
      "json",
      "xml",
    ];
    for (const sourceType of types) {
      expect(() =>
        sourceCreateSchema.parse({ appId: "app_123", sourceType, parserKey: "test" }),
      ).not.toThrow();
    }
  });
});

describe("sourceUpdateSchema", () => {
  it("parses valid review statuses", () => {
    for (const reviewStatus of ["pending", "approved", "rejected", "disabled"]) {
      const result = sourceUpdateSchema.parse({ reviewStatus });
      expect(result.reviewStatus).toBe(reviewStatus);
    }
  });
});

describe("releaseCreateSchema", () => {
  it("parses a valid release with defaults", () => {
    const result = releaseCreateSchema.parse({ appId: "app_123", versionRaw: "2.0.0" });
    expect(result.channel).toBe("stable");
  });

  it("rejects empty versionRaw", () => {
    expect(releaseCreateSchema.safeParse({ appId: "app_123", versionRaw: "" }).success).toBe(false);
  });
});

describe("releaseUpdateSchema", () => {
  it("parses valid release statuses", () => {
    for (const status of ["active", "superseded", "draft", "withdrawn"]) {
      const result = releaseUpdateSchema.parse({ status });
      expect(result.status).toBe(status);
    }
  });
});

describe("releasePinSchema", () => {
  it("parses with default channel", () => {
    const result = releasePinSchema.parse({ releaseId: "rel_123" });
    expect(result.channel).toBe("stable");
  });

  it("accepts custom channel", () => {
    const result = releasePinSchema.parse({ releaseId: "rel_123", channel: "beta" });
    expect(result.channel).toBe("beta");
  });
});
