# Agent Instructions

## Package Manager

- Use `pnpm` for workspace commands.
- Install: `pnpm install`
- Root dev stack: `pnpm dev` (`@versioneer/api` + `@versioneer/dashboard`)
- Start extra apps explicitly: `pnpm --filter @versioneer/web dev`, `pnpm --filter @versioneer/worker dev`

## File-Scoped Commands

| Task                    | Command                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| Lint one file           | `pnpm exec oxlint path/to/file.ts`                                          |
| Format-check one file   | `pnpm exec oxfmt --check path/to/file.ts`                                   |
| Typecheck one workspace | `pnpm --filter @versioneer/api check-types`                                 |
| Test one core file      | `pnpm --filter @versioneer/core exec vitest run path/to/test.test.ts`       |
| Test one dashboard file | `pnpm --filter @versioneer/dashboard exec vitest run path/to/test.test.tsx` |
| Regenerate worker types | `pnpm --filter @versioneer/api typegen:workers`                             |

## Validation

- JS/TS changes: `pnpm lint`, `pnpm fmt:check`, `pnpm check-types`, `pnpm test`
- `apps/desktop` changes: also run:

```bash
xcodebuild -project apps/desktop/Versioneer.xcodeproj -scheme Versioneer -destination 'platform=macOS' -derivedDataPath "$PWD/.build/DerivedData" -clonedSourcePackagesDirPath "$PWD/.build/DerivedData/SourcePackages" ENABLE_USER_SCRIPT_SANDBOXING=NO CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' test
```

## Monorepo Map

- `apps/api`: Hono API Worker.
- `apps/worker`: queue + scheduled Worker.
- `apps/dashboard`: React/Vite admin SPA.
- `apps/web`: React/Vite marketing site.
- `apps/desktop`: SwiftUI macOS app and `VersioneerTests`.
- `packages/core`: shared logic; import subpaths only, e.g. `@versioneer/core/pipeline`.
- `packages/db`: Drizzle schema in `packages/db/src/schema/`; migrations in `packages/db/migrations/`.
- `packages/tsconfig`: shared TS configs.

## Key Conventions

- Do not edit `routeTree.gen.ts` or `worker-configuration.d.ts` files by hand.
- Dashboard API access goes through `apps/dashboard/src/api/client.ts`; query hooks live in `apps/dashboard/src/api/hooks/`.
- Workspace packages are consumed from source; no `dist/` output.
- Edit D1 schema in `packages/db/src/schema/*.ts`, then run `pnpm db:generate`.
- After `wrangler.jsonc` binding changes, run `pnpm --filter <workspace> typegen:workers`.
- Keep desktop privileged-install changes aligned across `apps/desktop/VersioneerPrivilegedHelper/` and `apps/desktop/VersioneerShared/`.
