import { normalizeVersion } from "@versioneer/core/versioning";
import type { Database } from "@versioneer/db";

import {
  seedAlias,
  seedApp,
  seedArtifact,
  seedLatestRelease,
  seedRelease,
  seedSource,
} from "../../../__tests__/seed";

/**
 * Seeds a realistic catalog for inventory tests.
 *
 * - App A (Firefox): public, bundle_id + homebrew_cask aliases, sparkle source, release 130.0, universal dmg artifact
 * - App B (Sketch): public, bundle_id alias, mac_app_store source, release 100.0, arm64-only zip artifact (minOS 14.0)
 * - App C (Draft App): draft status, bundle_id alias — matched but not public
 * - App D (No Source App): public, bundle_id alias — no approved authority source, no latest release
 */
export async function seedInventoryCatalog(db: Database) {
  // --- App A: Firefox (fully tracked, sparkle) ---
  const appA = await seedApp(db, {
    canonicalName: "Firefox",
    vendorName: "Mozilla",
    status: "public",
  });
  await seedAlias(db, appA.id, {
    aliasType: "bundle_id",
    value: "org.mozilla.firefox",
    normalizedValue: "org.mozilla.firefox",
  });
  await seedAlias(db, appA.id, {
    aliasType: "homebrew_cask",
    value: "firefox",
    normalizedValue: "firefox",
  });
  const sourceA = await seedSource(db, appA.id, {
    sourceType: "sparkle",
    parserKey: "sparkle",
    reviewStatus: "approved",
    role: "authority",
    status: "active",
    lastSuccessAt: new Date().toISOString(),
  });
  const releaseA = await seedRelease(db, appA.id, {
    versionRaw: "130.0",
    versionNormalized: normalizeVersion("130.0"),
    channel: "stable",
    status: "active",
    publishedBySourceId: sourceA.id,
    releasedAt: "2026-03-01T00:00:00Z",
  });
  const artifactA = await seedArtifact(db, releaseA.id, {
    artifactType: "dmg",
    url: "https://download.mozilla.org/firefox-130.0.dmg",
    sha256: "abc123",
    architecture: "universal",
    isPrimary: true,
  });
  await seedLatestRelease(db, {
    appId: appA.id,
    releaseId: releaseA.id,
    authoritySourceId: sourceA.id,
    versionNormalized: releaseA.versionNormalized,
    versionRaw: releaseA.versionRaw,
    releasedAt: releaseA.releasedAt!,
    installStrategy: "dmg_copy_replace",
  });

  // --- App B: Sketch (arm64-only, minOS 14.0) ---
  const appB = await seedApp(db, {
    canonicalName: "Sketch",
    vendorName: "Bohemian Coding",
    status: "public",
  });
  await seedAlias(db, appB.id, {
    aliasType: "bundle_id",
    value: "com.bohemiancoding.sketch3",
    normalizedValue: "com.bohemiancoding.sketch3",
  });
  const sourceB = await seedSource(db, appB.id, {
    sourceType: "mac_app_store",
    parserKey: "mac_app_store",
    reviewStatus: "approved",
    role: "authority",
    status: "active",
    lastSuccessAt: new Date().toISOString(),
  });
  const releaseB = await seedRelease(db, appB.id, {
    versionRaw: "100.0",
    versionNormalized: normalizeVersion("100.0"),
    channel: "stable",
    status: "active",
    publishedBySourceId: sourceB.id,
    releasedAt: "2026-02-15T00:00:00Z",
  });
  const artifactB = await seedArtifact(db, releaseB.id, {
    artifactType: "zip",
    url: "https://example.com/sketch-100.zip",
    architecture: "arm64",
    minOsVersion: "14.0",
    isPrimary: true,
  });
  await seedLatestRelease(db, {
    appId: appB.id,
    releaseId: releaseB.id,
    authoritySourceId: sourceB.id,
    versionNormalized: releaseB.versionNormalized,
    versionRaw: releaseB.versionRaw,
    releasedAt: releaseB.releasedAt!,
    installStrategy: "mac_app_store",
  });

  // --- App C: Draft App ---
  const appC = await seedApp(db, { canonicalName: "Draft App", status: "draft" });
  await seedAlias(db, appC.id, {
    aliasType: "bundle_id",
    value: "com.example.draft",
    normalizedValue: "com.example.draft",
  });

  // --- App D: No Source App (public but no approved authority source) ---
  const appD = await seedApp(db, { canonicalName: "No Source App", status: "public" });
  await seedAlias(db, appD.id, {
    aliasType: "bundle_id",
    value: "com.example.nosource",
    normalizedValue: "com.example.nosource",
  });

  return { appA, appB, appC, appD, releaseA, releaseB, artifactA, artifactB, sourceA, sourceB };
}
