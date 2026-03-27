#!/usr/bin/env bash
set -euo pipefail

# Versioneer deploy script
# Usage: ./scripts/deploy.sh [--env production|dev] [--skip-checks]
#
# Deploys all Cloudflare apps (api, queue-consumer, dashboard)
# and applies D1 migrations for the target environment.

ENV="production"
SKIP_CHECKS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="$2"
      shift 2
      ;;
    --skip-checks)
      SKIP_CHECKS=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: ./scripts/deploy.sh [--env production|dev] [--skip-checks]" >&2
      exit 1
      ;;
  esac
done

if [[ "$ENV" != "production" && "$ENV" != "dev" ]]; then
  echo "Error: --env must be 'production' or 'dev'" >&2
  exit 1
fi

echo "==> Deploying to: $ENV"

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

if [[ "$SKIP_CHECKS" == false ]]; then
  echo "==> Running quality gates"
  pnpm run lint
  pnpm run fmt:check
  pnpm run check-types
  pnpm run test
  echo "==> All quality gates passed"
fi

# Resolve D1 database name and wrangler env flag
if [[ "$ENV" == "production" ]]; then
  D1_DATABASE="versioneer-db-production"
  WRANGLER_ENV_FLAG="--env production"
else
  D1_DATABASE="versioneer-db-dev"
  WRANGLER_ENV_FLAG=""
fi

echo "==> Applying D1 migrations ($D1_DATABASE)"
pnpm --filter @versioneer/db exec wrangler d1 migrations apply "$D1_DATABASE" --remote $WRANGLER_ENV_FLAG

echo "==> Deploying API worker"
pnpm --filter @versioneer/api exec wrangler deploy $WRANGLER_ENV_FLAG

echo "==> Deploying queue consumer"
pnpm --filter @versioneer/queue-consumer exec wrangler deploy $WRANGLER_ENV_FLAG

echo "==> Deploying dashboard"
# the --env flag won't work here; see https://developers.cloudflare.com/workers/vite-plugin/reference/migrating-from-wrangler-dev/#cloudflare-environments
CLOUDFLARE_ENV="$ENV" pnpm --filter @versioneer/dashboard run build
CLOUDFLARE_ENV="$ENV" pnpm --filter @versioneer/dashboard exec wrangler deploy

echo "==> Deploying landing page"
pnpm --filter @versioneer/web run build
pnpm --filter @versioneer/web exec wrangler pages deploy

echo "==> Deploy complete ($ENV)"
