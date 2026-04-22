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
 * - App E (Split App): public, bundle_id alias, separate arm64 and x86_64 latest rows
 * - App F (Unknown Arch App): public, bundle_id alias, unknown artifact architecture
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
    artifactId: artifactA.id,
    targetArchitecture: "arm64",
    versionNormalized: releaseA.versionNormalized,
    versionRaw: releaseA.versionRaw,
    releasedAt: releaseA.releasedAt!,
    installStrategy: "dmg_copy_replace",
  });
  await seedLatestRelease(db, {
    appId: appA.id,
    releaseId: releaseA.id,
    authoritySourceId: sourceA.id,
    artifactId: artifactA.id,
    targetArchitecture: "x86_64",
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
    artifactId: artifactB.id,
    targetArchitecture: "arm64",
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

  // --- App E: Split App (newer arm64 release, older x86_64 release) ---
  const appE = await seedApp(db, {
    canonicalName: "Split App",
    vendorName: "Split Vendor",
    status: "public",
  });
  await seedAlias(db, appE.id, {
    aliasType: "bundle_id",
    value: "com.example.split",
    normalizedValue: "com.example.split",
  });
  const sourceE = await seedSource(db, appE.id, {
    sourceType: "github_releases",
    parserKey: "github_releases",
    reviewStatus: "approved",
    role: "authority",
    status: "active",
    lastSuccessAt: new Date().toISOString(),
  });
  const releaseEArm = await seedRelease(db, appE.id, {
    versionRaw: "3.0.0",
    versionNormalized: normalizeVersion("3.0.0"),
    channel: "stable",
    status: "active",
    publishedBySourceId: sourceE.id,
    releasedAt: "2026-03-10T00:00:00Z",
  });
  const artifactEArm = await seedArtifact(db, releaseEArm.id, {
    artifactType: "dmg",
    url: "https://example.com/split-3.0.0-arm64.dmg",
    sha256: "armhash",
    architecture: "arm64",
    isPrimary: true,
  });
  const releaseEX86 = await seedRelease(db, appE.id, {
    versionRaw: "2.5.0",
    versionNormalized: normalizeVersion("2.5.0"),
    channel: "stable",
    status: "active",
    publishedBySourceId: sourceE.id,
    releasedAt: "2026-02-10T00:00:00Z",
  });
  const artifactEX86 = await seedArtifact(db, releaseEX86.id, {
    artifactType: "dmg",
    url: "https://example.com/split-2.5.0-x86_64.dmg",
    sha256: "x86hash",
    architecture: "x86_64",
    isPrimary: true,
  });
  await seedLatestRelease(db, {
    appId: appE.id,
    releaseId: releaseEArm.id,
    authoritySourceId: sourceE.id,
    artifactId: artifactEArm.id,
    targetArchitecture: "arm64",
    versionNormalized: releaseEArm.versionNormalized,
    versionRaw: releaseEArm.versionRaw,
    releasedAt: releaseEArm.releasedAt!,
    installStrategy: "dmg_copy_replace",
  });
  await seedLatestRelease(db, {
    appId: appE.id,
    releaseId: releaseEX86.id,
    authoritySourceId: sourceE.id,
    artifactId: artifactEX86.id,
    targetArchitecture: "x86_64",
    versionNormalized: releaseEX86.versionNormalized,
    versionRaw: releaseEX86.versionRaw,
    releasedAt: releaseEX86.releasedAt!,
    installStrategy: "dmg_copy_replace",
  });

  // --- App F: Unknown Arch App (update visible, one-click suppressed) ---
  const appF = await seedApp(db, {
    canonicalName: "Unknown Arch App",
    vendorName: "Unknown Vendor",
    status: "public",
  });
  await seedAlias(db, appF.id, {
    aliasType: "bundle_id",
    value: "com.example.unknownarch",
    normalizedValue: "com.example.unknownarch",
  });
  const sourceF = await seedSource(db, appF.id, {
    sourceType: "github_releases",
    parserKey: "github_releases",
    reviewStatus: "approved",
    role: "authority",
    status: "active",
    lastSuccessAt: new Date().toISOString(),
  });
  const releaseF = await seedRelease(db, appF.id, {
    versionRaw: "2.0.0",
    versionNormalized: normalizeVersion("2.0.0"),
    channel: "stable",
    status: "active",
    publishedBySourceId: sourceF.id,
    releasedAt: "2026-03-11T00:00:00Z",
  });
  const artifactF = await seedArtifact(db, releaseF.id, {
    artifactType: "dmg",
    url: "https://example.com/unknown-2.0.0.dmg",
    sha256: "unknownhash",
    architecture: "unknown",
    isPrimary: true,
  });
  await seedLatestRelease(db, {
    appId: appF.id,
    releaseId: releaseF.id,
    authoritySourceId: sourceF.id,
    artifactId: artifactF.id,
    targetArchitecture: "arm64",
    versionNormalized: releaseF.versionNormalized,
    versionRaw: releaseF.versionRaw,
    releasedAt: releaseF.releasedAt!,
    installStrategy: "dmg_copy_replace",
  });

  return {
    appA,
    appB,
    appC,
    appD,
    appE,
    appF,
    releaseA,
    releaseB,
    releaseEArm,
    releaseEX86,
    releaseF,
    artifactA,
    artifactB,
    artifactEArm,
    artifactEX86,
    artifactF,
    sourceA,
    sourceB,
    sourceE,
    sourceF,
  };
}
