import { describe, it, expect } from "vitest";

import { extractBundleIdsFromCask } from "../cask-index-sync";

describe("extractBundleIdsFromCask", () => {
  it("extracts bundle IDs from zap trash plist paths", () => {
    const artifacts = [
      {
        zap: [
          {
            trash: [
              "~/Library/Preferences/com.googlecode.iterm2.plist",
              "~/Library/Preferences/com.googlecode.iterm2.iTermFileProvider.plist",
            ],
          },
        ],
      },
    ];
    const result = extractBundleIdsFromCask(artifacts);
    expect(result).toContain("com.googlecode.iterm2");
    expect(result).toContain("com.googlecode.iterm2.itermfileprovider");
  });

  it("extracts bundle IDs from container paths", () => {
    const artifacts = [
      {
        zap: [
          {
            trash: [
              "~/Library/Containers/com.microsoft.VSCode",
              "~/Library/Caches/com.microsoft.VSCode",
            ],
          },
        ],
      },
    ];
    const result = extractBundleIdsFromCask(artifacts);
    expect(result).toContain("com.microsoft.vscode");
  });

  it("extracts bundle IDs from uninstall quit directives", () => {
    const artifacts = [
      {
        uninstall: [
          {
            quit: "com.1password.1password",
          },
        ],
      },
    ];
    const result = extractBundleIdsFromCask(artifacts);
    expect(result).toContain("com.1password.1password");
  });

  it("extracts bundle IDs from uninstall quit arrays", () => {
    const artifacts = [
      {
        uninstall: [
          {
            quit: ["com.example.app", "com.example.helper"],
          },
        ],
      },
    ];
    const result = extractBundleIdsFromCask(artifacts);
    expect(result).toContain("com.example.app");
    expect(result).toContain("com.example.helper");
  });

  it("deduplicates bundle IDs", () => {
    const artifacts = [
      {
        zap: [
          {
            trash: [
              "~/Library/Preferences/com.example.app.plist",
              "~/Library/Caches/com.example.app",
            ],
          },
        ],
      },
    ];
    const result = extractBundleIdsFromCask(artifacts);
    const occurrences = result.filter((id) => id === "com.example.app");
    expect(occurrences).toHaveLength(1);
  });

  it("extracts from group containers", () => {
    const artifacts = [
      {
        zap: [
          {
            trash: ["~/Library/Group Containers/2BUA8C4S2C.com.1password"],
          },
        ],
      },
    ];
    const result = extractBundleIdsFromCask(artifacts);
    expect(result).toContain("com.1password");
  });

  it("returns empty array for artifacts without bundle IDs", () => {
    const artifacts = [{ app: ["SomeApp.app"] }];
    const result = extractBundleIdsFromCask(artifacts);
    expect(result).toHaveLength(0);
  });

  it("handles empty artifacts array", () => {
    const result = extractBundleIdsFromCask([]);
    expect(result).toHaveLength(0);
  });

  it("ignores non-bundle-ID strings", () => {
    const artifacts = [
      {
        zap: [
          {
            trash: ["~/Library/Preferences/some-random-file.txt", "/tmp/not-a-bundle-id"],
          },
        ],
      },
    ];
    const result = extractBundleIdsFromCask(artifacts);
    expect(result).toHaveLength(0);
  });
});
