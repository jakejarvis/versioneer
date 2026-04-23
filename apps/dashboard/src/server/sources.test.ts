import { describe, expect, it } from "vite-plus/test";

import { computeReorderedSourceRoles, validateSourceReorderInput } from "./source-reorder";

describe("validateSourceReorderInput", () => {
  it("accepts a complete unique reorder for the app", () => {
    expect(
      validateSourceReorderInput({
        appSourceIds: ["src_a", "src_b", "src_c"],
        requestedSourceIds: ["src_c", "src_a", "src_b"],
      }),
    ).toBeNull();
  });

  it("rejects partial reorder payloads", () => {
    expect(
      validateSourceReorderInput({
        appSourceIds: ["src_a", "src_b", "src_c"],
        requestedSourceIds: ["src_b", "src_a"],
      }),
    ).toBe("Source reorder must include every app source exactly once");
  });

  it("rejects duplicate source IDs", () => {
    expect(
      validateSourceReorderInput({
        appSourceIds: ["src_a", "src_b", "src_c"],
        requestedSourceIds: ["src_a", "src_a", "src_b"],
      }),
    ).toBe("Source reorder contains duplicate source IDs");
  });

  it("rejects sources that do not belong to the app", () => {
    expect(
      validateSourceReorderInput({
        appSourceIds: ["src_a", "src_b"],
        requestedSourceIds: ["src_a", "src_other"],
      }),
    ).toBe("Source src_other does not belong to app");
  });

  it("keeps one authority source per channel after reordering", () => {
    const roles = computeReorderedSourceRoles({
      sources: [
        { id: "src_stable_a", sourceType: "sparkle", channel: null },
        { id: "src_stable_b", sourceType: "github_releases", channel: null },
        { id: "src_beta_a", sourceType: "sparkle", channel: "beta" },
        { id: "src_beta_b", sourceType: "electron_generic", channel: "beta" },
        { id: "src_brew", sourceType: "homebrew_cask", channel: null },
      ],
      requestedSourceIds: ["src_stable_b", "src_beta_a", "src_brew", "src_stable_a", "src_beta_b"],
    });

    expect(roles.get("src_stable_b")).toBe("authority");
    expect(roles.get("src_beta_a")).toBe("authority");
    expect(roles.get("src_brew")).toBe("corroborating");
    expect(roles.get("src_stable_a")).toBe("corroborating");
    expect(roles.get("src_beta_b")).toBe("corroborating");
  });
});
