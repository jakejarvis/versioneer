# Versioneer

macOS app update tracker. A native desktop app scans installed apps and checks for updates; a Cloudflare-based backend maintains a catalog of canonical app identities, ingests update information from sources (Sparkle appcasts, GitHub releases), and returns update decisions to clients.

## Commands

```bash
pnpm install              # Install all dependencies
pnpm dev                  # Start all dev servers (turbo)
pnpm check-types          # Typecheck all packages (turbo)
pnpm lint                 # Lint all packages with oxlint (turbo)
pnpm lint:fix             # Lint + autofix (turbo)
pnpm fmt                  # Format all files with oxfmt (turbo)
pnpm fmt:check            # Check formatting (turbo)
pnpm test                 # Run all tests (vitest per-package, via turbo)

pnpm db:generate          # Generate Drizzle migrations from schema
pnpm db:migrate:local     # Apply migrations to local D1
pnpm db:migrate:remote    # Apply migrations to remote D1

# Deploy
pnpm --filter @versioneer/api run deploy
pnpm --filter @versioneer/queue-consumer run deploy

# Dev servers individually
pnpm --filter @versioneer/api dev              # API worker on :8787
pnpm --filter @versioneer/dashboard dev        # Dashboard on :5173 (proxies /internal to :8787)
```

## Architecture

Cloudflare-native monorepo. pnpm workspaces + Turborepo.

### Apps

| App                   | Stack                     | Deploys to         |
| --------------------- | ------------------------- | ------------------ |
| `apps/api`            | Hono on CF Workers        | Cloudflare Workers |
| `apps/queue-consumer` | CF Workers queue consumer | Cloudflare Workers |
| `apps/dashboard`      | React + Vite SPA          | Cloudflare Pages   |
| `apps/web`            | React + Vite landing page | Cloudflare Pages   |
| `apps/desktop`        | Swift/SwiftUI macOS app   | GitHub Releases    |

### Packages

All packages are consumed via source — no build step. Apps bundle them via Wrangler/Vite.

| Package    | Purpose                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `core`     | Identity matching, version parsing, source parsers, validation, pipeline, cache |
| `db`       | Drizzle ORM schema, client, migrations, D1 binding config                       |
| `tsconfig` | Shared tsconfig bases (base, library, worker, react-vite)                       |

`core` uses subpath exports — import from `@versioneer/core/identity`, `@versioneer/core/pipeline`, etc.

### Cloudflare Bindings

The API worker and queue consumer share these bindings:

- **D1** (`DB`): Relational source of truth
- **R2** (`RAW_BUCKET`): Raw source fetch bodies
- **R2** (`ASSETS_BUCKET`): Desktop release artifacts and assets
- **KV** (`CACHE_KV`): Hot-path latest release cache
- **KV** (`CONFIG_KV`): Feature flags, kill switches
- **Queues**: `source-fetch`, `source-parse`, `artifact-verify`, `recompute-latest`, `dlq`

### API Routes

Public (`/v1`): `POST /v1/inventory/check`, `GET /v1/apps/:appId`, `GET /v1/apps/:appId/releases`, `POST /v1/install/prepare`, `POST /v1/install/executions/:executionId/status`, `GET /v1/releases/:releaseId/notes`, `POST /v1/feedback`

### Queue Pipeline

`source-fetch` -> `source-parse` -> `recompute-latest`. Handlers in `packages/core/src/pipeline/`. The queue consumer dispatches by queue name in `apps/queue-consumer/src/index.ts`. A scheduled handler runs `handleComputeScorecard` to compute per-app quality scores.

Additional pipeline modules: `release-notes.ts` (normalize/render release notes), `sanitize-html.ts`, `scorecard.ts` (quality metrics), `verification.ts` (verification tiers), `installability.ts` (installability classification), `explain.ts` (decision rationale).

## Key Patterns

### ID System

All entities use prefixed nanoid text IDs: `app_xxx`, `src_xxx`, `rel_xxx`, etc. Generated via `generateId(idPrefixes.app)` from `@versioneer/db`. Full prefix list: `app`, `alias`, `mr`, `src`, `fetch`, `parse`, `rel`, `obs`, `art`, `artc`, `alr`, `ir`, `cli`, `snap`, `cia`, `ovr`, `jf`, `rq`, `al`, `asc`, `shm`, `onb`, `fb`, `arto`, `exec`, `dapp`.

### TypeScript Config

Shared configs in `packages/tsconfig/`. Each package extends one:

- **library.json**: declaration + sourceMap (packages)
- **worker.json**: CF Workers types + noEmit (api, queue-consumer)
- **react-vite.json**: DOM + JSX + noEmit (dashboard)

All packages use `noEmit` — no `dist/` is produced. Apps resolve workspace packages via path aliases pointing at source.

### Dashboard

React 19 + Vite 8 + TanStack Router (file-based, auto-generated route tree) + TanStack Query + shadcn/ui (new-york style) + Tailwind v4.

- Route tree: `src/routeTree.gen.ts` (auto-generated — do not edit directly)
- API client: `src/api/client.ts` — fetch wrapper prepending `/internal`
- Hooks: `src/api/hooks/use-*.ts` — TanStack Query hooks per resource
- Shared components: `src/components/shared/` (DataTable, StatusBadge, TimeAgo, IdDisplay, etc.)
- Vite proxies `/internal/*` to `:8787` in dev

### Desktop App

Swift/SwiftUI native macOS app. Xcode project at `apps/desktop/Versioneer.xcodeproj`.

- Scans `/Applications` and `~/Applications` for installed apps, submits inventory to the API, displays update decisions
- Multi-strategy version checking: backend API + local Sparkle appcast parsing + Electron update feed checking
- Installation orchestration: Sparkle, ZIP replace, DMG copy, PKG install — routes through local or privileged helper as needed
- Privileged helper (`VersioneerPrivilegedHelper`) is an XPC service for admin-required installs
- Self-updates via Sparkle framework (appcast at `dl.versioneer.app/appcast.xml`)
- Firebase Analytics + Crashlytics for telemetry
- Tests use Swift Testing framework (not XCTest), 12 test files in `VersioneerTests/`
- `scripts/render-release-notes.ts` renders markdown release notes to HTML using the pipeline package

### Database Migrations

Owned by `packages/db`. Drizzle Kit generates from `packages/db/src/schema/*.ts`. Migrations live in `packages/db/migrations/`. The `packages/db/wrangler.jsonc` has a minimal D1 binding just for running `wrangler d1 migrations apply`.

## Quality Gates

All four must pass with zero errors AND zero warnings before committing or declaring a task complete:

```bash
pnpm run lint          # oxlint — 0 warnings, 0 errors
pnpm run fmt:check     # oxfmt — no formatting diffs
pnpm run check-types   # tsc --noEmit across all packages
pnpm run test          # vitest — all tests pass
```

## Code Style

- oxfmt for formatting (config in `.oxfmtrc.json`)
- oxlint for linting (config in `.oxlintrc.json`)
- Import sorting handled by oxfmt (groups: builtin, external, internal, relative)
- Double quotes, trailing commas, 2-space indent, semicolons
