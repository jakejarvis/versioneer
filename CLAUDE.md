# Versioneer

macOS app update tracking backend. Scans installed apps, maintains a catalog of canonical app identities, ingests update information from sources (Sparkle appcasts, GitHub releases), and returns update decisions to clients.

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
pnpm --filter @versioneer/api-worker run deploy
pnpm --filter @versioneer/queue-consumer run deploy

# Dev servers individually
pnpm --filter @versioneer/api-worker dev       # API worker on :8787
pnpm --filter @versioneer/admin-web dev        # Admin UI on :5173 (proxies /internal to :8787)
```

## Architecture

Cloudflare-native monorepo. pnpm workspaces + Turborepo.

### Apps

| App                   | Stack                     | Deploys to         |
| --------------------- | ------------------------- | ------------------ |
| `apps/api-worker`     | Hono on CF Workers        | Cloudflare Workers |
| `apps/queue-consumer` | CF Workers queue consumer | Cloudflare Workers |
| `apps/admin-web`      | React + Vite SPA          | Cloudflare Pages   |

### Packages

All packages are consumed via source (`main: "src/index.ts"`) — no build step. Apps bundle them via Wrangler/Vite.

| Package             | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `schema`            | Drizzle ORM table definitions (D1/SQLite)                 |
| `db`                | Drizzle client, migrations, D1 binding config             |
| `validation`        | Zod schemas (inventory, admin, common)                    |
| `api-contracts`     | Shared API request/response types                         |
| `identity`          | App matching logic (bundle ID, team ID, aliases)          |
| `versioning`        | Version parsing, normalization, comparison                |
| `parsers`           | Source parsers (Sparkle, GitHub releases)                 |
| `pipeline`          | Queue job handlers (fetch, parse, recompute)              |
| `cache`             | KV read/write helpers                                     |
| `typescript-config` | Shared tsconfig bases (base, library, worker, react-vite) |

### Cloudflare Bindings

The API worker and queue consumer share these bindings:

- **D1** (`DB`): Relational source of truth
- **R2** (`RAW_BUCKET`): Raw source fetch bodies
- **KV** (`CACHE_KV`): Hot-path latest release cache
- **KV** (`CONFIG_KV`): Feature flags, kill switches
- **Queues**: `source-fetch`, `source-parse`, `artifact-verify`, `recompute-latest`, `dlq`

### API Routes

Public (`/v1`): `POST /v1/inventory/check`, `GET /v1/apps/:appId`, `GET /v1/apps/:appId/releases`

Internal (`/internal`): Full CRUD for apps, aliases, sources, releases, install-rules, overrides, review-queue, job-failures, audit-log, stats. Sub-routers in `apps/api-worker/src/routes/internal/`.

### Queue Pipeline

`source-fetch` -> `source-parse` -> `recompute-latest`. Handlers in `packages/pipeline/src/`. The queue consumer dispatches by queue name in `apps/queue-consumer/src/index.ts`.

## Key Patterns

### ID System

All entities use prefixed nanoid text IDs: `app_xxx`, `src_xxx`, `rel_xxx`, etc. Generated via `generateId(idPrefixes.app)` from `@versioneer/schema`.

### TypeScript Config

Shared configs in `packages/typescript-config/`. Each package extends one:

- **library.json**: declaration + sourceMap (packages)
- **worker.json**: CF Workers types + noEmit (api-worker, queue-consumer)
- **react-vite.json**: DOM + JSX + noEmit (admin-web)

All packages use `noEmit` — no `dist/` is produced. Apps resolve workspace packages via path aliases pointing at source.

### Admin Web

React 19 + Vite 8 + TanStack Router (manual route tree, not codegen) + TanStack Query + shadcn/ui (new-york style) + Tailwind v4.

- Route tree: `src/routeTree.gen.ts` (manually maintained, uses `createRoute` not `createFileRoute`)
- API client: `src/api/client.ts` — fetch wrapper prepending `/internal`
- Hooks: `src/api/hooks/use-*.ts` — TanStack Query hooks per resource
- Shared components: `src/components/shared/` (DataTable, StatusBadge, TimeAgo, IdDisplay, etc.)
- Vite proxies `/internal/*` to `:8787` in dev

### Database Migrations

Owned by `packages/db`. Drizzle Kit generates from `packages/schema/src/*.ts`. Migrations live in `packages/db/migrations/`. The `packages/db/wrangler.jsonc` has a minimal D1 binding just for running `wrangler d1 migrations apply`.

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
