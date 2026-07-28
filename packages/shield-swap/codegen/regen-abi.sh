#!/usr/bin/env bash
# Regenerate pinned shield_swap-stack ABIs using the Leo CLI.
# We do NOT parse .aleo ourselves — `leo abi` produces the canonical ABI JSON.
#
# Fetches each program plus its transitive imports from the node API, stages
# the imports in the `imports/` layout `leo abi` expects, and pins both the
# bytecode (<name>.aleo) and the ABI (<name>.json) under codegen/abi/.
#
# Usage: packages/shield-swap/codegen/regen-abi.sh [program ...]
#        (default: the deployed shield_swap stack programs the SDK binds to)
set -euo pipefail
PROGRAMS=("${@:-shield_swap.aleo shield_swap_router.aleo shield_swap_lp_router.aleo}")
if [ $# -eq 0 ]; then
  PROGRAMS=(shield_swap.aleo shield_swap_router.aleo shield_swap_lp_router.aleo)
fi
API="https://api.provable.com/v2/testnet/program"
DIR="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/imports"

# Fetches a program's bytecode once into $tmp, following `import x.aleo;`
# lines recursively so snarkVM validation inside `leo abi` finds every
# dependency. -f: fail on HTTP 4xx/5xx (a 404 error body is valid JSON and
# would otherwise be fed to `leo abi` as garbage).
fetch_with_imports() {
  local program="$1"
  [ -f "$tmp/imports/$program" ] && return 0
  curl -fsS "$API/$program" | jq -r . > "$tmp/imports/$program"
  # `|| true`: a leaf program has no import lines and grep's exit 1 must not
  # kill the recursion under pipefail.
  local deps
  deps="$(grep '^import ' "$tmp/imports/$program" | sed 's/^import \(.*\);$/\1/' || true)"
  local dep
  for dep in $deps; do
    fetch_with_imports "$dep"
  done
}

for PROGRAM in ${PROGRAMS[@]}; do
  fetch_with_imports "$PROGRAM"
  cp "$tmp/imports/$PROGRAM" "$tmp/$PROGRAM"
  # Write to a temp then move, so a failed `leo abi` never leaves truncated pins.
  leo abi "$tmp/$PROGRAM" -q --output "$tmp/out"
  mv "$tmp/out/$PROGRAM.abi.json" "$DIR/abi/${PROGRAM%.aleo}.json"
  cp "$tmp/$PROGRAM" "$DIR/abi/$PROGRAM"
  echo "wrote $DIR/abi/${PROGRAM%.aleo}.json + $DIR/abi/$PROGRAM"
done
