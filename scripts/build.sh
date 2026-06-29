#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

if command -v corepack >/dev/null 2>&1; then
    PNPM_CMD=(corepack pnpm)
else
    PNPM_CMD=(pnpm)
fi

if [ "${INSTALL_DEPS:-0}" = "1" ] || [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    "${PNPM_CMD[@]}" install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
else
    echo "Skipping dependency install. Set INSTALL_DEPS=1 to force it."
fi

echo "Building the Next.js project..."
"${PNPM_CMD[@]}" next build

echo "Bundling server with tsup..."
"${PNPM_CMD[@]}" tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"
