import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  assertValidSourceFetchUrl,
  isGitHubApiUrl,
  resolvePublicDnsAddresses,
  SourceUrlPolicyError,
} from "../source-url-policy";

async function expectPolicyReason(rawUrl: string, reason: SourceUrlPolicyError["reason"]) {
  await expect(
    assertValidSourceFetchUrl(rawUrl, {
      resolveAddresses: async () => ["93.184.216.34"],
    }),
  ).rejects.toMatchObject({ reason });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertValidSourceFetchUrl", () => {
  it("allows https URLs that resolve to public addresses", async () => {
    await expect(
      assertValidSourceFetchUrl("https://example.com/feed.xml", {
        resolveAddresses: async () => ["93.184.216.34"],
      }),
    ).resolves.toMatchObject({ hostname: "example.com" });
  });

  it("allows four-label public hostnames", async () => {
    const resolveAddresses = vi.fn<(hostname: string) => Promise<string[]>>(async () => [
      "104.21.87.201",
    ]);

    await expect(
      assertValidSourceFetchUrl("https://release.files.ghostty.org/appcast.xml", {
        resolveAddresses,
      }),
    ).resolves.toMatchObject({ hostname: "release.files.ghostty.org" });
    expect(resolveAddresses).toHaveBeenCalledWith("release.files.ghostty.org");
  });

  it("rejects invalid and non-https URLs", async () => {
    await expectPolicyReason("not a url", "invalid_url");
    await expectPolicyReason("http://example.com/feed.xml", "non_https");
  });

  it("rejects localhost and metadata hostnames before DNS", async () => {
    await expectPolicyReason("https://localhost/feed.xml", "blocked_hostname");
    await expectPolicyReason("https://metadata.google.internal/latest", "blocked_hostname");
  });

  it("rejects private, reserved, link-local, loopback, and metadata IP literals", async () => {
    await expectPolicyReason("https://127.0.0.1/feed.xml", "blocked_hostname");
    await expectPolicyReason("https://10.0.0.1/feed.xml", "blocked_hostname");
    await expectPolicyReason("https://172.16.0.1/feed.xml", "blocked_hostname");
    await expectPolicyReason("https://192.168.1.10/feed.xml", "blocked_hostname");
    await expectPolicyReason("https://169.254.169.254/latest", "blocked_hostname");
    await expectPolicyReason("https://203.0.113.10/feed.xml", "blocked_hostname");
  });

  it("rejects blocked IPv6 literals", async () => {
    await expectPolicyReason("https://[::1]/feed.xml", "blocked_hostname");
    await expectPolicyReason("https://[fe80::1]/feed.xml", "blocked_hostname");
    await expectPolicyReason("https://[fc00::1]/feed.xml", "blocked_hostname");
  });

  it("rejects DNS-resolved private targets", async () => {
    await expect(
      assertValidSourceFetchUrl("https://updates.example.com/feed.xml", {
        resolveAddresses: async () => ["93.184.216.34", "10.0.0.2"],
      }),
    ).rejects.toMatchObject({ reason: "blocked_resolved_address" });
  });

  it("rejects DNS-resolved expanded and mapped IPv6 loopback targets", async () => {
    await expect(
      assertValidSourceFetchUrl("https://updates.example.com/feed.xml", {
        resolveAddresses: async () => ["0:0:0:0:0:0:0:1"],
      }),
    ).rejects.toMatchObject({ reason: "blocked_resolved_address" });

    await expect(
      assertValidSourceFetchUrl("https://updates.example.com/feed.xml", {
        resolveAddresses: async () => ["0:0:0:0:0:ffff:7f00:1"],
      }),
    ).rejects.toMatchObject({ reason: "blocked_resolved_address" });
  });

  it("rejects domains with no public A or AAAA answers", async () => {
    await expect(
      assertValidSourceFetchUrl("https://updates.example.com/feed.xml", {
        resolveAddresses: async () => [],
      }),
    ).rejects.toMatchObject({ reason: "dns_no_public_addresses" });
  });
});

describe("resolvePublicDnsAddresses", () => {
  it("ignores CNAME-only answers", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ Answer: [{ type: 5, data: "target.example.com" }] }))
      .mockResolvedValueOnce(Response.json({ Answer: [] }));

    await expect(resolvePublicDnsAddresses("alias.example.com")).resolves.toEqual([]);
  });
});

describe("isGitHubApiUrl", () => {
  it("only matches the GitHub API HTTPS host", () => {
    expect(isGitHubApiUrl("https://api.github.com/repos/a/b/releases")).toBe(true);
    expect(isGitHubApiUrl("https://github.com/repos/a/b/releases")).toBe(false);
    expect(isGitHubApiUrl("https://api.github.com.evil.example/repos")).toBe(false);
    expect(isGitHubApiUrl("http://api.github.com/repos/a/b/releases")).toBe(false);
  });
});
