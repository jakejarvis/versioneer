# RFC 001: Release Channel Support

| Field       | Value                        |
|-------------|------------------------------|
| Title       | Release Channel Support      |
| Author      | (to be assigned)             |
| Date        | 2026-03-28                   |
| Status      | Draft                        |
| Stakeholders| API team, Desktop team, Ops  |

## Summary

Extend Versioneer so that sources can be explicitly assigned to release channels (stable, beta, nightly), clients can opt into non-stable channels on a per-app or global basis, and the dashboard provides full visibility into multi-channel release tracking. The majority of the backend data model already supports channels; this RFC closes the remaining gaps in source-to-channel assignment, client channel preferences, and end-to-end channel-aware update delivery.

## Motivation

Many macOS applications publish separate update feeds for different release channels. For example, a project may have a stable Sparkle appcast and a separate beta appcast, or GitHub releases where pre-releases represent a beta channel. Today, Versioneer has partial channel infrastructure:

- The `releases` table has a `channel` column (stable/beta/nightly).
- The `app_latest_releases` table is keyed by `(appId, channel)`.
- The `recompute-latest` pipeline iterates over all three channels.
- Parsers infer channel from version strings (e.g., "1.0-beta1" maps to beta).

However, critical gaps remain:

1. **Sources have no channel assignment.** A source that fetches a beta appcast still has its releases auto-classified by version string parsing, which is fragile and incorrect for feeds that contain only beta releases with "normal-looking" version numbers (e.g., "2.0.0" in a beta feed is still beta).
2. **The inventory check endpoint always returns stable.** The public API only looks at `latestByApp` with preference for the stable channel; clients cannot request beta or nightly updates.
3. **The desktop client has no channel preference UI.** Users cannot opt into beta channels for specific apps or globally.
4. **The dashboard cannot assign channels to sources.** Admins cannot say "this Sparkle feed is the beta feed for app X."

Closing these gaps enables accurate multi-channel tracking and lets power users opt into pre-release update channels.

## Current State Analysis

### Data Model (Already Channel-Aware)

**`releases` table** (`packages/schema/src/releases.ts` line 6-35):
- Has `channel` column: `text("channel", { enum: ["stable", "beta", "nightly"] }).notNull().default("stable")`
- Has index `idx_releases_app_channel` on `(appId, channel)`
- Has `isPrerelease` boolean

**`app_latest_releases` table** (`packages/schema/src/releases.ts` line 145-173):
- Has `channel` column with same enum
- Unique index `idx_latest_app_channel` on `(appId, channel)` -- one latest per channel per app
- Stores `releaseId`, `artifactId`, `versionNormalized`, `versionRaw`, `decisionSource`, `confidence`, `installabilityClass`

**`release_observations` table** (`packages/schema/src/releases.ts` line 37-64):
- Has `observedChannel` column (nullable text, no enum constraint)

**`sources` table** (`packages/schema/src/sources.ts` line 5-34):
- **No channel column.** This is the primary gap. Sources have `sourceType`, `baseUrl`, `parserKey`, `configJson`, but no way to explicitly declare "this source feeds the beta channel."

### Cache Layer (`packages/cache/`)

Already channel-aware:
- `latestReleaseKey(appId, channel)` returns `latest:app:${appId}:${channel}` (line 1 of `keys.ts`)
- `getCachedLatest(kv, appId, channel = "stable")` defaults to stable (line 20 of `helpers.ts`)
- `setCachedLatest(kv, data)` uses `data.channel` to build the key (line 33 of `helpers.ts`)

### Pipeline

**`handleSourceParse`** (`packages/pipeline/src/parse.ts` line 21-259):
- Line 89: `const channel = parsedRelease.channel || inferChannel(parsedRelease.versionRaw);`
- Channel comes from the parser output first, falls back to `inferChannel()` which checks pre-release tags.
- The source's own properties are NOT consulted for channel -- only the parsed version string matters.

**`handleRecomputeLatest`** (`packages/pipeline/src/recompute.ts` line 24-274):
- Line 24: `const CHANNELS = ["stable", "beta", "nightly"] as const;`
- Line 32: Iterates over all channels (or just the specified one), queries releases by `(appId, channel, status="active")`, picks highest version, writes to `app_latest_releases`.
- Line 69: Checks admin overrides keyed by `${appId}:${channel}`.
- Line 213-221: Writes cache via `setCachedLatest(cacheKV, { appId, channel, ... })`.

**`handleSourceFetch`** (`packages/pipeline/src/fetch.ts`):
- Fetches the source URL, stores raw body in R2, enqueues parse job. No channel logic.

### Parsers (`packages/parsers/src/`)

**`sparkleParser`** (`sparkle.ts` line 101): Sets `channel: inferChannel(version)` on each parsed release.
**`githubReleasesParser`** (`github.ts` line 62-67): Uses `ghRelease.prerelease` flag combined with `inferChannel(versionRaw)`.
**`homebrewCaskParser`** (`homebrew-cask.ts` line 88): Sets `channel: inferChannel(versionRaw)`.

All parsers output `ParsedRelease.channel` from version string inference. None consult a source-level channel override.

### `inferChannel` (`packages/versioning/src/normalize.ts` line 32-38):

```ts
export function inferChannel(raw: string): "stable" | "beta" | "nightly" {
  const parsed = parseVersion(raw);
  if (!parsed.preReleaseTag) return "stable";
  const tag = parsed.preReleaseTag;
  if (tag === "nightly" || tag === "dev") return "nightly";
  return "beta";
}
```

This means a beta appcast that publishes versions like "3.5.0" (no pre-release tag) will incorrectly classify those releases as "stable."

### Public API - Inventory Check (`apps/api/src/routes/public/inventory.ts`)

Lines 352-359: Loads all `app_latest_releases`, then builds a map preferring stable:
```ts
const latestByApp = new Map<string, (typeof latestReleases)[number]>();
for (const lr of latestReleases) {
  const key = lr.appId;
  const existing = latestByApp.get(key);
  if (!existing || lr.channel === "stable") {
    latestByApp.set(key, lr);
  }
}
```

This means only the stable channel latest is ever returned to clients. There is no mechanism for a client to request beta updates.

The `InventoryCheckRequest` (`packages/validation/src/inventory.ts`) and the Swift `InventoryCheckRequest` (`apps/desktop/Versioneer/Models/InventoryRequest.swift`) have no channel preference field.

The `AppDecision` response type (`packages/validation/src/inventory.ts` line 39-64) has no channel field in the response either.

### Dashboard

**Source create form** (`packages/validation/src/admin.ts` line 56-64): `sourceCreateSchema` has no channel field.
**Source update form** (`packages/validation/src/admin.ts` line 66-73): `sourceUpdateSchema` has no channel field.
**Release list** (`apps/dashboard/src/api/hooks/use-releases.ts`): Already supports filtering by channel.
**Release update** (`packages/validation/src/admin.ts` line 75-78): Already allows changing channel.
**App detail page** (`apps/dashboard/src/routes/apps/$appId.tsx`): Shows latest releases per channel (already multi-channel aware in the `getApp` server function which returns all `appLatestReleases` rows).

### Desktop Client (`apps/desktop/`)

**SettingsStore** (`Versioneer/Services/SettingsStore.swift`): Has `baseURL`, `scanOnLaunch`, `ignoredAppRules`. No channel preference.
**AppState** (`Versioneer/State/AppState.swift`): `scanAndSubmit()` calls `apiClient.checkInventory()` with no channel info. Result merging has no channel awareness.
**AppDecision** (`Versioneer/Models/AppDecision.swift`): No channel field in the model.

## Proposed Design

### Design Principles

1. **Source-level channel assignment is the primary mechanism.** When a source explicitly declares a channel, all releases parsed from it are assigned that channel, overriding version-string inference.
2. **Version-string inference remains the fallback.** Sources with no explicit channel (or `channel = null`) continue to use `inferChannel()` per-release.
3. **Client channel preferences are per-app with a global default.** Users can say "give me beta updates for app X" or "give me beta updates for everything."
4. **Backward compatible.** Existing sources with no channel set continue to work identically. Existing clients with no channel preferences get stable updates.

### Data Model Changes

#### 1. Add `channel` column to `sources` table

```sql
ALTER TABLE sources ADD COLUMN channel TEXT;
```

The column is nullable. When set, it overrides the parser's per-release channel inference for all releases produced by this source. Valid values: `"stable"`, `"beta"`, `"nightly"`, or `NULL` (infer from version string).

File: `packages/schema/src/sources.ts` -- add column after `parserKey`:
```ts
channel: text("channel", { enum: ["stable", "beta", "nightly"] }),
```

No default -- `NULL` means "infer from version string" (current behavior).

#### 2. Add `channelPreferences` to inventory check request

File: `packages/validation/src/inventory.ts` -- extend `inventoryCheckRequestSchema.client`:
```ts
channelPreferences: z.object({
  defaultChannel: z.enum(["stable", "beta", "nightly"]).default("stable"),
  perApp: z.record(z.string(), z.enum(["stable", "beta", "nightly"])).default({}),
}).optional(),
```

This is fully optional. Omitting it gives the current behavior (stable only).

#### 3. Add `channel` to `AppDecision` response

File: `packages/validation/src/inventory.ts` -- extend `appDecisionSchema`:
```ts
channel: z.enum(["stable", "beta", "nightly"]).nullable(),
```

This tells the client which channel the returned latest release belongs to.

### Pipeline Changes

#### Source Parse (`packages/pipeline/src/parse.ts`)

After loading the source (line 41), read its `channel` property. When constructing each release:

```ts
// Line 89 changes from:
const channel = parsedRelease.channel || inferChannel(parsedRelease.versionRaw);
// To:
const channel = source.channel ?? parsedRelease.channel ?? inferChannel(parsedRelease.versionRaw);
```

The source-level channel takes precedence. If the source has `channel = "beta"`, all parsed releases from it are beta, regardless of what `inferChannel` would say.

This is a one-line change with high leverage.

#### Recompute Latest (`packages/pipeline/src/recompute.ts`)

No changes needed. The handler already iterates over all channels and correctly queries releases by channel. The `RecomputeLatestJob` already supports an optional `channel` field.

#### Source Fetch (`packages/pipeline/src/fetch.ts`)

No changes needed. Fetch is channel-agnostic.

### API Changes

#### Public Inventory Check (`apps/api/src/routes/public/inventory.ts`)

**Channel selection logic** (replaces lines 352-359):

For each matched app, determine the requested channel:
1. Check `request.client.channelPreferences.perApp[appId]`
2. Fall back to `request.client.channelPreferences.defaultChannel`
3. Fall back to `"stable"`

Then look up the `app_latest_releases` row for that channel. If no latest exists for the requested channel, fall back to stable.

This requires restructuring the `latestByApp` map to be keyed by `(appId, channel)` instead of just `appId`. Since `appLatestReleases` already has rows per channel, we load all of them and build a `Map<string, Map<string, LatestRelease>>` (appId -> channel -> latest).

Add `channel` to the `AppDecision` result object.

#### Public Apps Releases (`apps/api/src/routes/public/apps.ts`)

The `GET /v1/apps/:appId/releases` endpoint already returns all releases. Optionally add a `?channel=beta` query parameter for filtering (low priority, already possible on the dashboard side).

#### Internal Source CRUD

**`sourceCreateSchema`** (`packages/validation/src/admin.ts`): Add `channel: z.enum(["stable", "beta", "nightly"]).nullable().optional()`.

**`sourceUpdateSchema`** (`packages/validation/src/admin.ts`): Add `channel: z.enum(["stable", "beta", "nightly"]).nullable().optional()`.

**Dashboard `createSource` server function** (`apps/dashboard/src/server/sources.ts`): Pass `channel` through to insert.

**Dashboard `updateSource` server function** (`apps/dashboard/src/server/sources.ts`): Pass `channel` through to update.

### Cache Changes

No structural changes needed. The cache key already includes channel: `latest:app:${appId}:${channel}`. The `setCachedLatest` and `getCachedLatest` functions already accept channel parameters. The inventory check just needs to call `getCachedLatest(kv, appId, requestedChannel)` instead of always using `"stable"`.

### Dashboard UI Changes

#### Source Create/Edit Forms

Add a "Channel" dropdown to the source create and edit forms with options: "Auto-detect" (null), "Stable", "Beta", "Nightly". Default to "Auto-detect".

Files affected:
- `apps/dashboard/src/routes/apps/$appId.tsx` -- source creation within app detail
- `apps/dashboard/src/routes/sources/$sourceId.tsx` -- source detail page
- `apps/dashboard/src/api/hooks/use-sources.ts` -- `useCreateSource` mutation type
- `apps/dashboard/src/api/types.ts` -- `Source` interface

#### Source List

Show a channel badge on sources that have an explicit channel set.

File: `apps/dashboard/src/routes/sources/index.tsx` -- add column or badge.

#### App Detail - Latest Releases

Already shows all latest release rows (one per channel). No change needed for the data; consider adding channel tabs or a channel filter dropdown if the UI becomes cluttered.

### Desktop Client Changes

#### Settings: Channel Preferences

Add a `channelPreferences` property to `SettingsStore`:
- `defaultChannel: Channel` (defaults to `.stable`)
- `perAppChannels: [String: Channel]` (keyed by `matchedAppId`)

File: `apps/desktop/Versioneer/Services/SettingsStore.swift`

Add a `Channel` enum:
```swift
enum Channel: String, Codable, CaseIterable, Sendable {
  case stable
  case beta
  case nightly
}
```

#### Settings UI

Add a "Release Channel" section to `SettingsView.swift` with:
- A global default channel picker
- A note explaining what beta/nightly channels mean

Per-app channel overrides can be added via a context menu on `AppListRowView` (e.g., "Switch to Beta Channel" / "Switch to Stable Channel").

#### Inventory Request

Update `InventoryCheckRequest` to include channel preferences:
```swift
struct ChannelPreferences: Codable, Sendable {
  let defaultChannel: String
  let perApp: [String: String]
}
```

Add `channelPreferences: ChannelPreferences?` to `InventoryCheckRequest`.

In `InventoryAPIClient`, populate this from `SettingsStore` when building the request.

#### AppDecision Model

Add `channel: String?` to `AppDecision.swift`. This is backward-compatible since it's optional and decoded with `decodeIfPresent`.

#### UI Indicators

Show a small "Beta" or "Nightly" badge next to the version number in `AppListRowView` when the returned channel is not stable. This helps users understand which channel they're tracking.

### Migration Strategy

#### Database Migration

A single migration adding the nullable `channel` column to `sources`:

```sql
ALTER TABLE sources ADD COLUMN channel TEXT;
```

No data backfill needed -- `NULL` means "auto-detect" which is the current behavior.

#### Rollout

1. Deploy backend changes (schema migration + pipeline + API) first. With no client changes, behavior is identical since:
   - All sources have `channel = NULL` (auto-detect).
   - All clients send no `channelPreferences` (defaults to stable).
2. Deploy dashboard changes so admins can assign channels to sources.
3. Deploy desktop client update with channel preference UI.

This ordering ensures backward compatibility at every step.

## Implementation Tasks

### Task 1: Schema Migration -- Add `channel` to `sources`

**Objective:** Add a nullable `channel` column to the `sources` table.

**Files to modify:**
- `packages/schema/src/sources.ts` -- add `channel` column to `sources` table definition
- Generate migration: `pnpm db:generate`

**Acceptance criteria:**
- `pnpm db:generate` produces a new migration file with `ALTER TABLE sources ADD COLUMN channel TEXT`
- `pnpm check-types` passes
- `pnpm test` passes (no existing tests broken)

**Dependencies:** None
**Complexity:** S

---

### Task 2: Validation Schema Updates

**Objective:** Add channel field to source create/update schemas and channel preferences to inventory check request.

**Files to modify:**
- `packages/validation/src/admin.ts` -- add `channel` to `sourceCreateSchema` and `sourceUpdateSchema`
- `packages/validation/src/inventory.ts` -- add `channelPreferences` to `inventoryCheckRequestSchema.client`, add `channel` to `appDecisionSchema`
- `packages/contracts/src/index.ts` -- update `ReleaseInfo` or any other types referencing channel

**Acceptance criteria:**
- `sourceCreateSchema` accepts optional nullable `channel` field
- `sourceUpdateSchema` accepts optional nullable `channel` field
- `inventoryCheckRequestSchema` accepts optional `channelPreferences` with `defaultChannel` and `perApp`
- `appDecisionSchema` includes `channel` field (nullable)
- All existing validation tests still pass
- `pnpm check-types` passes

**Dependencies:** None (can be done in parallel with Task 1)
**Complexity:** S

---

### Task 3: Pipeline -- Source-Level Channel Override in Parser

**Objective:** Make the source parse handler use the source's explicit `channel` field when set, overriding version-string inference.

**Files to modify:**
- `packages/pipeline/src/parse.ts` -- change line 89 to consult `source.channel` first

**Acceptance criteria:**
- When `source.channel` is `"beta"`, all releases parsed from that source get `channel = "beta"` regardless of version string
- When `source.channel` is `null`, behavior is unchanged (infer from version string)
- Add a unit test in `packages/pipeline/src/__tests__/` verifying the override behavior
- `pnpm test` passes
- `pnpm check-types` passes

**Dependencies:** Task 1 (schema must have the column)
**Complexity:** S

---

### Task 4: Dashboard Server -- Source CRUD Channel Field

**Objective:** Pass the `channel` field through source create and update operations.

**Files to modify:**
- `apps/dashboard/src/server/sources.ts` -- `createSource` handler to include `channel` in insert, `updateSource` handler to include `channel` in update
- `apps/dashboard/src/api/types.ts` -- add `channel` field to `Source`, `SourceListItem`, `SourceDetail` interfaces
- `apps/dashboard/src/api/hooks/use-sources.ts` -- add `channel` to `useCreateSource` input type

**Acceptance criteria:**
- Creating a source with `channel: "beta"` persists the value
- Updating a source's channel to `"nightly"` or `null` persists correctly
- `pnpm check-types` passes

**Dependencies:** Task 1, Task 2
**Complexity:** S

---

### Task 5: Dashboard UI -- Source Channel Selector

**Objective:** Add a channel dropdown to source create and edit UI.

**Files to modify:**
- `apps/dashboard/src/routes/apps/$appId.tsx` -- source creation form (within the app detail page's sources tab)
- `apps/dashboard/src/routes/sources/$sourceId.tsx` -- source detail page, add channel display and edit control
- `apps/dashboard/src/routes/sources/index.tsx` -- source list, show channel badge

**Acceptance criteria:**
- Source create form includes a "Channel" select with options: Auto-detect, Stable, Beta, Nightly
- Source detail page displays current channel and allows changing it
- Source list shows a small channel indicator when a source has an explicit channel
- UI follows existing shadcn/ui patterns (Select component, StatusBadge-like badges)

**Dependencies:** Task 4
**Complexity:** M

---

### Task 6: Public API -- Channel-Aware Inventory Check

**Objective:** Update the inventory check endpoint to respect client channel preferences and return the appropriate channel's latest release.

**Files to modify:**
- `apps/api/src/routes/public/inventory.ts` -- restructure `latestByApp` map, add channel selection logic per matched app, include `channel` in `AppDecision` response

**Acceptance criteria:**
- When `channelPreferences` is omitted, behavior is identical to current (stable only)
- When `channelPreferences.defaultChannel = "beta"`, matched apps return beta channel latest releases
- When `channelPreferences.perApp["app_xxx"] = "nightly"`, that specific app returns nightly latest; others use the default
- If no latest exists for the requested channel, falls back to stable
- `channel` field is included in each `AppDecision` response
- `pnpm check-types` passes

**Dependencies:** Task 2 (validation schema updates)
**Complexity:** M

---

### Task 7: Desktop Client -- Channel Preference Model and Storage

**Objective:** Add channel preference support to the desktop app's data model and settings persistence.

**Files to modify:**
- `apps/desktop/Versioneer/Models/AppDecision.swift` -- add `channel: String?` property
- `apps/desktop/Versioneer/Models/InventoryRequest.swift` -- add `ChannelPreferences` struct and field
- `apps/desktop/Versioneer/Services/SettingsStore.swift` -- add `defaultChannel` and `perAppChannels` properties
- `apps/desktop/Versioneer/Services/InventoryAPIClient.swift` -- include channel preferences in request payload

**Acceptance criteria:**
- `AppDecision` decodes `channel` from server response (nullable, backward-compatible)
- `InventoryCheckRequest` includes `channelPreferences` when non-default
- `SettingsStore` persists and retrieves channel preferences via UserDefaults
- Desktop app compiles and existing tests pass

**Dependencies:** Task 2, Task 6
**Complexity:** M

---

### Task 8: Desktop Client -- Channel Preference UI

**Objective:** Add UI for users to configure channel preferences.

**Files to modify:**
- `apps/desktop/Versioneer/Views/SettingsView.swift` -- add "Release Channel" section with global default picker
- `apps/desktop/Versioneer/Views/AppListRowView.swift` -- show channel badge when non-stable
- `apps/desktop/Versioneer/Views/DetailOverlayView.swift` -- show channel info in detail view
- `apps/desktop/Versioneer/State/AppState.swift` -- wire channel preferences to scan flow

**Acceptance criteria:**
- Settings view has a "Release Channel" section with a Picker for Stable/Beta/Nightly
- Per-app channel override available via context menu on app rows (e.g., "Track Beta Channel")
- Non-stable channel results show a visible "Beta" or "Nightly" badge
- Changing channel preference triggers a rescan

**Dependencies:** Task 7
**Complexity:** M

---

### Task 9: End-to-End Testing and Documentation

**Objective:** Verify the full pipeline works end-to-end with channel-assigned sources and client channel preferences.

**Tasks:**
- Create a test scenario: app with two sources (one stable Sparkle feed, one beta Sparkle feed)
- Verify that fetch -> parse -> recompute produces separate latest releases for stable and beta channels
- Verify that a client requesting beta gets the beta latest
- Verify that a client requesting stable (or no preference) gets the stable latest
- Verify fallback: client requests beta but no beta releases exist, gets stable
- Update CLAUDE.md if any new patterns or conventions were introduced

**Files to modify:**
- New or extended tests in `packages/pipeline/src/__tests__/`
- Potentially `packages/validation/src/contracts.test.ts` for schema validation coverage

**Acceptance criteria:**
- All quality gates pass (`pnpm lint`, `pnpm fmt:check`, `pnpm check-types`, `pnpm test`)
- Manual verification of the scenario described above

**Dependencies:** Tasks 1-6
**Complexity:** M

## Risks and Mitigations

### Risk 1: Source channel override produces duplicate releases

If an app has a "stable" source and a "beta" source, and both sources report version "3.0.0", the parse handler currently deduplicates by `(versionNormalized, channel)`. With source-level channel, the same version from the beta source would be classified as beta, creating a separate release record. This is actually the **desired behavior** -- the same version can exist in multiple channels (beta promoted to stable, for instance).

**Mitigation:** The existing deduplication logic in `parse.ts` (line 99-101) already checks `(versionNormalized, channel)` for matching, so this is already handled correctly.

### Risk 2: Cache invalidation on channel preference changes

When a user changes their channel preference, the next inventory check will request different data. Since cache keys already include channel, and the public API does fresh lookups against the DB (with cache as optimization), this is not a problem.

**Mitigation:** None needed -- architecture already handles this.

### Risk 3: Backward compatibility for desktop clients

Older desktop clients that don't send `channelPreferences` must continue to receive stable updates.

**Mitigation:** The `channelPreferences` field is optional in the schema. The API defaults to stable when absent. The `channel` field in `AppDecision` response is nullable and decoded with `decodeIfPresent` in Swift.

### Risk 4: Admin confusion about channel vs. auto-detect

Admins might not understand when to use explicit channel assignment vs. auto-detect.

**Mitigation:** Dashboard UI should clearly label the default as "Auto-detect (from version string)" and provide a tooltip explaining when explicit assignment is needed (e.g., "Use this when the feed contains beta releases with normal version numbers").

## Testing Strategy

### Unit Tests
- `packages/pipeline/src/__tests__/`: Test that `handleSourceParse` correctly applies source-level channel override
- `packages/validation/src/`: Test that updated schemas validate channel fields correctly
- `packages/versioning/src/__tests__/`: Existing `inferChannel` tests remain unchanged

### Integration Tests
- Test the full pipeline: create source with `channel = "beta"` -> fetch -> parse -> verify releases have `channel = "beta"` -> recompute latest -> verify `app_latest_releases` has beta entry -> verify cache has beta entry

### Manual Testing
- Dashboard: create source with channel, verify it persists, trigger fetch, verify parsed releases
- Desktop: change channel preference in settings, rescan, verify beta updates appear
- Backward compatibility: verify old clients (no channel preferences) still get stable updates

## Open Questions

1. **Should per-app channel overrides be synced to the server?** Currently proposed as client-local (stored in UserDefaults). An alternative is storing them server-side per client, which would enable cross-device consistency but adds complexity. **Recommendation: start client-local, add server sync later if needed.**

2. **Should we support custom channel names beyond stable/beta/nightly?** Some apps have channels like "canary", "alpha", "insider". For now, the three-channel enum is sufficient. Custom channels would require a schema change from enum to free-text, which adds complexity. **Recommendation: keep the three-channel enum for now.**

3. **Should the desktop client show all channels simultaneously?** E.g., "Stable: 2.0.0, Beta: 2.1.0-beta3" in one row. This would require the API to return multiple latest releases per app. **Recommendation: return only the user's preferred channel per app. A "show all channels" view can be a future enhancement.**
