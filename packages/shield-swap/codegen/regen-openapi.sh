#!/usr/bin/env bash
# Regenerate the pinned AMM (DEX) API OpenAPI spec + generated TS types.
# The spec is the canonical tool output (no hand-written REST types).
#
# The testnet host is the source of the pinned spec because it is a superset
# of the mainnet one: it also serves the faucet (`/airdrop`) and `/debug/pool`
# routes. The mainnet spec is fetched alongside and checked to be a subset
# with identical shared definitions, so the generated types hold on both
# networks. Routes that only testnet serves are printed at the end; keep the
# "testnet only" notes on the matching ApiClient methods in sync with them.
#
# Usage: packages/shield-swap/codegen/regen-openapi.sh
# Override either source with VEIL_DEX_API_URL (testnet) or
# VEIL_DEX_API_URL_MAINNET (mainnet), e.g. to point at a local stack.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
TESTNET_BASE="${VEIL_DEX_API_URL:-https://api.testnet.swap.shield.fi}"
MAINNET_BASE="${VEIL_DEX_API_URL_MAINNET:-https://api.swap.shield.fi}"
curl -fsS "${TESTNET_BASE%/}/openapi.json" > "$tmp/testnet.json"
curl -fsS "${MAINNET_BASE%/}/openapi.json" > "$tmp/mainnet.json"
node "$DIR/codegen/amm-api/check-networks.mjs" "$tmp/testnet.json" "$tmp/mainnet.json"
mv "$tmp/testnet.json" "$DIR/codegen/amm-api/amm-api.json"
(cd "$DIR" && pnpm exec openapi-typescript codegen/amm-api/amm-api.json -o src/api/openapi.ts)
echo "wrote $DIR/codegen/amm-api/amm-api.json + src/api/openapi.ts"
