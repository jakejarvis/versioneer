#!/usr/bin/env bash
set -euo pipefail

# Versioneer deploy script
# Usage: ./scripts/deploy.sh [--skip-checks]

SKIP_CHECKS=false
if [[ "${1:-}" == "--skip-checks" ]]; then
  SKIP_CHECKS=true
fi

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

echo "==> Applying D1 migrations"
pnpm db:migrate:remote

echo "==> Deploying API worker"
pnpm --filter @versioneer/api-worker run deploy

echo "==> Deploying queue consumer"
pnpm --filter @versioneer/queue-consumer run deploy

echo "==> Deploying admin web"
pnpm --filter @versioneer/admin-web run deploy

echo "==> Deploy complete"
