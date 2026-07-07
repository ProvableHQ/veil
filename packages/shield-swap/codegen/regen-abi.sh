#!/usr/bin/env bash
# Regenerate a pinned shield_swap ABI using the Leo CLI.
# We do NOT parse .aleo ourselves — `leo abi` produces the canonical ABI JSON.
# Usage: packages/shield-swap/codegen/regen-abi.sh [program]   (default: shield_swap_v3.aleo)
set -euo pipefail
PROGRAM="${1:-shield_swap_v3.aleo}"
OUT="$(cd "$(dirname "$0")" && pwd)/abi/${PROGRAM%.aleo}.json"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# -f: fail on HTTP 4xx/5xx (a 404 error body is valid JSON and would otherwise
# be fed to `leo abi` as garbage). pipefail (set above) surfaces a curl failure.
curl -fsS "https://api.provable.com/v2/testnet/program/$PROGRAM" | jq -r . > "$tmp/$PROGRAM"
# Write to a temp then move, so a failed `leo abi` never leaves a truncated ABI.
leo abi "$tmp/$PROGRAM" -q > "$tmp/abi.json"
mv "$tmp/abi.json" "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
