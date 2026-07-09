#!/usr/bin/env bash
# Refreshes the vendored AMM program sources the devnode lifecycle e2e suites
# deploy. Fetches the deployed shield_swap_v3.aleo and its multisig import from
# the testnet API and writes them under test/fixtures/programs/. Run when the
# deployed contract changes:
#
#   ./packages/shield-swap/codegen/refresh-devnode-fixtures.sh
#
# The ARC-20 token fixtures (test_token_a/b.leo) are hand-vendored Leo sources,
# not refreshed here. credits.aleo is read from the devnode at test time.
set -euo pipefail

API="${VEIL_API_URL:-https://api.provable.com/v2}/testnet/program"
DIR="$(cd "$(dirname "$0")/../test/fixtures/programs" && pwd)"

for program in shield_swap_v3.aleo test_shield_swap_multisig_core.aleo; do
  echo "Fetching $program …"
  # The API returns the source as a JSON string literal; jq -r unwraps it.
  curl -fsSL "$API/$program" | jq -r '.' > "$DIR/$program"
  head -1 "$DIR/$program"
done
echo "Wrote fixtures to $DIR"
