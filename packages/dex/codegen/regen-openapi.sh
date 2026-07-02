#!/usr/bin/env bash
# Regenerate the pinned AMM (DEX) API OpenAPI spec + generated TS types.
# The spec is the canonical tool output (no hand-written REST types).
# Usage: packages/dex/codegen/regen-openapi.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsS "https://amm-api.dev.provable.com/openapi.json" > "$tmp/openapi.json"
mv "$tmp/openapi.json" "$DIR/codegen/amm-api/amm-api.json"
(cd "$DIR" && pnpm exec openapi-typescript codegen/amm-api/amm-api.json -o src/api/openapi.ts)
echo "wrote $DIR/codegen/amm-api/amm-api.json + src/api/openapi.ts"
