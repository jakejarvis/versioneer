# Agent Instructions

## Package Manager

- Use [Vite+](https://viteplus.dev/guide/) (`vp`) for workspace commands and package management.
- Install: `vp install`
- Root dev stack: `vp run dev` (`@versioneer/api` + `@versioneer/dashboard`)
- Start extra apps explicitly: `vp run --filter @versioneer/web dev`, `vp run --filter @versioneer/worker dev`

## File-Scoped Commands

| Task                    | Command                                            |
| ----------------------- | -------------------------------------------------- |
| Lint one file           | `vp lint path/to/file.ts`                          |
| Format-check one file   | `vp fmt path/to/file.ts --check`                   |
| Build one workspace     | `vp run --filter @versioneer/dashboard build`      |
| Test one core file      | `vp test packages/core/src/path/to/test.test.ts`   |
| Test one dashboard file | `vp test apps/dashboard/src/path/to/test.test.tsx` |
| Regenerate worker types | `vp run --filter @versioneer/api cf-typegen`       |

## Validation

- JS/TS changes: `vp check`, `vp test`
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
- Edit D1 schema in `packages/db/src/schema/*.ts`, then run `vp run db:generate`.
- After `wrangler.jsonc` binding changes, run `vp run --filter <workspace> cf-typegen`.
- Keep desktop privileged-install changes aligned across `apps/desktop/VersioneerPrivilegedHelper/` and `apps/desktop/VersioneerShared/`.
