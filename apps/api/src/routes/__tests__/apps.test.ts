import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import { getDb, seedApp, seedRelease, seedSource } from "../../__tests__/seed";
import app from "../../index";

describe("GET /v1/apps/:appId", () => {
  it("returns app details for a public app", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db, {
      canonicalName: "Firefox",
      vendorName: "Mozilla",
      status: "public",
    });

    const res = await app.request(`/v1/apps/${testApp.id}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; canonicalName: string };
    expect(body.id).toBe(testApp.id);
    expect(body.canonicalName).toBe("Firefox");
  });

  it("returns 404 for non-public app", async () => {
    const db = getDb(env.DB);
    const draftApp = await seedApp(db, { status: "draft" });

    const res = await app.request(`/v1/apps/${draftApp.id}`, {}, env);
    expect(res.status).toBe(404);
  });

  it("returns 404 for nonexistent app", async () => {
    const res = await app.request("/v1/apps/app_nonexistent", {}, env);
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/apps/:appId/releases", () => {
  it("returns active releases for a public app", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db, { status: "public" });
    const source = await seedSource(db, testApp.id);
    await seedRelease(db, testApp.id, {
      versionRaw: "1.0.0",
      versionNormalized: "0000001.0000000.0000000",
      status: "active",
      publishedBySourceId: source.id,
    });
    await seedRelease(db, testApp.id, {
      versionRaw: "2.0.0",
      versionNormalized: "0000002.0000000.0000000",
      status: "active",
      publishedBySourceId: source.id,
    });

    const res = await app.request(`/v1/apps/${testApp.id}/releases`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { releases: { versionRaw: string }[] };
    expect(body.releases).toHaveLength(2);
  });

  it("returns 404 for non-public app releases", async () => {
    const db = getDb(env.DB);
    const draftApp = await seedApp(db, { status: "draft" });

    const res = await app.request(`/v1/apps/${draftApp.id}/releases`, {}, env);
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/releases/:releaseId/notes", () => {
  it("returns release notes HTML", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db, { status: "public" });
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, {
      releaseNotesHtml: "<p>Bug fixes</p>",
      publishedBySourceId: source.id,
    });

    const res = await app.request(`/v1/releases/${release.id}/notes`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      releaseNotesHtml: string | null;
      releaseNotesUrl: string | null;
    };
    expect(body.releaseNotesHtml).toBe("<p>Bug fixes</p>");
  });

  it("falls back to app defaultReleaseNotesUrl", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db, {
      status: "public",
      defaultReleaseNotesUrl: "https://example.com/changelog",
    });
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });

    const res = await app.request(`/v1/releases/${release.id}/notes`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      releaseNotesHtml: string | null;
      releaseNotesUrl: string | null;
    };
    expect(body.releaseNotesUrl).toBe("https://example.com/changelog");
  });

  it("returns 404 for nonexistent release", async () => {
    const res = await app.request("/v1/releases/rel_nonexistent/notes", {}, env);
    expect(res.status).toBe(404);
  });
});
