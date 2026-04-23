import { buildArtifactIdentity } from "@versioneer/core/pipeline";
import {
  type Database,
  appAliases,
  appLatestReleases,
  apps,
  artifacts,
  clientFeedback,
  createDb,
  deviceAttestations,
  discoveredApps,
  generateId,
  idPrefixes,
  installExecutions,
  releases,
  sources,
} from "@versioneer/db";

export const TEST_NOW_ISO = "2026-03-31T12:00:00.000Z";

const now = () => TEST_NOW_ISO;

export function getDb(d1: D1Database): Database {
  return createDb(d1);
}

export async function seedApp(db: Database, overrides: Partial<typeof apps.$inferInsert> = {}) {
  const id = overrides.id ?? generateId(idPrefixes.app);
  const [row] = await db
    .insert(apps)
    .values({
      id,
      slug: `test-app-${id.slice(-8)}`,
      canonicalName: "Test App",
      status: "public",
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedAlias(
  db: Database,
  appId: string,
  overrides: Partial<typeof appAliases.$inferInsert> = {},
) {
  const value = overrides.value ?? "com.example.test";
  const [row] = await db
    .insert(appAliases)
    .values({
      id: overrides.id ?? generateId(idPrefixes.alias),
      appId,
      aliasType: "bundle_id",
      value,
      normalizedValue: value.toLowerCase(),
      isExact: true,
      priority: 0,
      confidenceWeight: 100,
      isActive: true,
      createdAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedSource(
  db: Database,
  appId: string,
  overrides: Partial<typeof sources.$inferInsert> = {},
) {
  const [row] = await db
    .insert(sources)
    .values({
      id: overrides.id ?? generateId(idPrefixes.source),
      appId,
      sourceType: "sparkle",
      parserKey: "sparkle",
      reviewStatus: "approved",
      role: "authority",
      status: "active",
      pollIntervalMinutes: 60,
      ordinal: 0,
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedRelease(
  db: Database,
  appId: string,
  overrides: Partial<typeof releases.$inferInsert> = {},
) {
  const [row] = await db
    .insert(releases)
    .values({
      id: overrides.id ?? generateId(idPrefixes.release),
      appId,
      versionRaw: "1.0.0",
      versionNormalized: "0000001.0000000.0000000",
      channel: "stable",
      status: "active",
      isPrerelease: false,
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedArtifact(
  db: Database,
  releaseId: string,
  overrides: Partial<typeof artifacts.$inferInsert> = {},
) {
  const url = overrides.url ?? "https://example.com/app.dmg";
  const sha256 = overrides.sha256 ?? null;
  const artifactIdentity = buildArtifactIdentity({ url, sha256 });
  const [row] = await db
    .insert(artifacts)
    .values({
      id: overrides.id ?? generateId(idPrefixes.artifact),
      releaseId,
      artifactType: "dmg",
      url,
      canonicalUrl: overrides.canonicalUrl ?? artifactIdentity.canonicalUrl,
      identityKey: overrides.identityKey ?? artifactIdentity.identityKey,
      sha256,
      isPrimary: true,
      createdAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedLatestRelease(
  db: Database,
  overrides: Partial<typeof appLatestReleases.$inferInsert> & {
    appId: string;
    releaseId: string;
    versionNormalized: string;
    versionRaw: string;
  },
) {
  const [row] = await db
    .insert(appLatestReleases)
    .values({
      id: generateId(idPrefixes.appLatestRelease),
      channel: "stable",
      targetArchitecture: "arm64",
      updatedAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedDiscoveredApp(
  db: Database,
  overrides: Partial<typeof discoveredApps.$inferInsert> = {},
) {
  const id = overrides.id ?? generateId(idPrefixes.discoveredApp);
  const [row] = await db
    .insert(discoveredApps)
    .values({
      id,
      lookupKey: overrides.lookupKey ?? `bid:com.test.${id.slice(-8)}`,
      appName: "Test Discovered App",
      sightingCount: 1,
      firstSeenAt: now(),
      lastSeenAt: now(),
      status: "pending",
      enrichmentStatus: "pending",
      sourceValidationStatus: "untested",
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedDeviceAttestation(
  db: Database,
  overrides: Partial<typeof deviceAttestations.$inferInsert> = {},
) {
  const id = overrides.id ?? generateId(idPrefixes.deviceAttestation);
  const [row] = await db
    .insert(deviceAttestations)
    .values({
      id,
      keyId: overrides.keyId ?? `key-${id.slice(-8)}`,
      publicKey: "test-public-key",
      counter: 0,
      createdAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedFeedback(
  db: Database,
  overrides: Partial<typeof clientFeedback.$inferInsert> = {},
) {
  const [row] = await db
    .insert(clientFeedback)
    .values({
      id: overrides.id ?? generateId(idPrefixes.feedback),
      feedbackType: "general",
      status: "new",
      createdAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}

export async function seedInstallExecution(
  db: Database,
  overrides: Partial<typeof installExecutions.$inferInsert> & {
    appId: string;
    releaseId: string;
  },
) {
  const [row] = await db
    .insert(installExecutions)
    .values({
      id: generateId(idPrefixes.installExecution),
      clientPlatform: "macos",
      installStrategy: "dmg_copy_replace",
      status: "prepared",
      preparedAt: now(),
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .returning();
  return row!;
}
