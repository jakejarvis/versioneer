# Versioneer

Versioneer is a macOS app update tracker with a native desktop client and a Cloudflare-based backend.

The desktop app scans installed apps, sends an inventory to the API, and shows update decisions to the user. The backend keeps a catalog of canonical app identities, ingests release data from sources like Sparkle appcasts and GitHub releases, and recomputes the best available update state for each app.

This repository contains the full system: the public API, internal dashboard, queue consumer, landing site, shared TypeScript packages, and the Swift/SwiftUI desktop app.

## What lives here

### Apps

- `apps/api` - Hono API running on Cloudflare Workers
- `apps/dashboard` - internal admin dashboard built with TanStack Start
- `apps/desktop` - native macOS client in SwiftUI
- `apps/queue-consumer` - queue worker that drives fetch, parse, verification, and recompute jobs
- `apps/web` - marketing site / landing page

### Shared packages

- `packages/schema` - Drizzle table definitions and ID helpers
- `packages/db` - database client, migrations, and D1 tooling
- `packages/contracts` - shared request/response types
- `packages/validation` - Zod schemas
- `packages/identity` - app matching and canonical identity logic
- `packages/versioning` - version parsing, normalization, and comparison
- `packages/parsers` - source parsers for upstream release feeds
- `packages/pipeline` - queue handlers and release processing logic
- `packages/cache` - KV helpers
- `packages/typescript-config` - shared TypeScript config presets

One important repo convention: shared packages are consumed directly from source. There is no separate package build step or checked-in `dist/` output for workspace libraries.

## How the system works

At a high level, Versioneer has two loops:

1. The desktop app scans `/Applications` and `~/Applications`, normalizes what it finds, and submits anonymous inventory data to the API.
2. The backend continuously ingests and recomputes release data through a queue pipeline so those update checks stay fresh.

The queue flow essentially boils down to:

`source-fetch` -> `source-parse` -> `recompute-latest`

Supporting pipeline modules also handle release notes rendering, HTML sanitization, installability classification, verification tiers, scorecards, and human-readable decision explanations.

## Tech stack

- `pnpm` workspaces
- Turborepo
- Cloudflare Workers, D1, KV, R2, and Queues
- TypeScript, Zod, Drizzle ORM
- React 19, Vite, TanStack Start/Router, TanStack Query, Tailwind v4, shadcn/ui
- Swift / SwiftUI for the desktop client

## Getting started

### Prerequisites

- A recent Node.js version that works with `pnpm@10`
- `pnpm`
- Wrangler / Cloudflare access for local Worker development
- Xcode if you plan to work on the macOS app

### Install dependencies

```bash
pnpm install
```

### Start the repo

Run the full dev graph:

```bash
pnpm dev
```

For focused work, the most common entry points are:

```bash
pnpm --filter @versioneer/api dev
pnpm --filter @versioneer/dashboard dev
```

The dashboard runs on `http://localhost:5173`. The API worker runs on `http://localhost:8787`.

If you are working on the macOS app, open:

`apps/desktop/Versioneer.xcodeproj`

## Database and migrations

Drizzle schema files live in `packages/schema/src`. Generated migrations live in `packages/db/migrations`.

Common commands:

```bash
pnpm db:generate
pnpm db:migrate
```

`pnpm db:migrate` applies the local D1 migrations configured in `packages/db`.

## Useful commands

```bash
pnpm dev
pnpm lint
pnpm lint:fix
pnpm fmt
pnpm fmt:check
pnpm check-types
pnpm test

pnpm --filter @versioneer/api deploy
pnpm --filter @versioneer/queue-consumer deploy
```

## License

MIT. See [LICENSE](LICENSE).
