#!/usr/bin/env bash
# Regenerate the pinned AMM (DEX) API OpenAPI spec + generated TS types.
# The spec is the canonical tool output (no hand-written REST types).
# Usage: packages/shield-swap/codegen/regen-openapi.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# Override the source with VEIL_DEX_API_URL (e.g. the staging or a local stack).
API_BASE="${VEIL_DEX_API_URL:-https://amm-api.dev.provable.com}"
curl -fsS "${API_BASE%/}/openapi.json" > "$tmp/openapi.json"
mv "$tmp/openapi.json" "$DIR/codegen/amm-api/amm-api.json"
(cd "$DIR" && pnpm exec openapi-typescript codegen/amm-api/amm-api.json -o src/api/openapi.ts)
echo "wrote $DIR/codegen/amm-api/amm-api.json + src/api/openapi.ts"
