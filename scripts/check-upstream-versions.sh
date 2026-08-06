#!/usr/bin/env bash
# Prints current-vs-latest for the four upstream Aleo dependency streams.
# Used by the update-dependencies skill; safe to run standalone. Read-only.
#
#   ./scripts/check-upstream-versions.sh
#
# Exit code: 0 when everything is current, 1 when at least one stream has a
# newer version available (or a check could not complete).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STALE=0

report() { # name current latest
  if [ "$2" = "$3" ]; then
    printf '%-40s %s (current)\n' "$1" "$2"
  else
    printf '%-40s %s -> %s  *** UPDATE AVAILABLE ***\n' "$1" "$2" "$3"
    STALE=1
  fi
}

# --- 1. @provablehq/sdk (npm) ---
sdk_latest=$(npm view @provablehq/sdk version 2>/dev/null || echo '?')
sdk_current=$(grep -o '"@provablehq/sdk": "[^"]*"' "$ROOT/packages/provable-sdk/package.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo '?')
report '@provablehq/sdk' "$sdk_current" "$sdk_latest"

# --- 2. leo (ProvableHQ/leo releases) ---
leo_latest=$(gh release list -R ProvableHQ/leo --limit 1 --json tagName --jq '.[0].tagName' 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo '?')
leo_current=$(leo --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo 'not installed')
report 'leo (binary on PATH)' "$leo_current" "$leo_latest"
leo_pinned=$(grep -oE 'LEO_RELEASE: leo-lang-v[0-9.]+' "$ROOT/.github/workflows/ci.yml" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo '?')
report 'leo (CI pin in ci.yml)' "$leo_pinned" "$leo_latest"

# --- 3. aleo-devnode (@provablehq/aleo-devnode on npm) ---
# Distributed as a prebuilt-binary npm package, so the version is pinned in the
# root package.json like any other dependency rather than by a CI release tag.
devnode_latest=$(npm view @provablehq/aleo-devnode version 2>/dev/null || echo '?')
devnode_pinned=$(node -e "process.stdout.write(require('$ROOT/package.json').devDependencies['@provablehq/aleo-devnode'] ?? '?')" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo '?')
report 'aleo-devnode (root package.json)' "$devnode_pinned" "$devnode_latest"
devnode_installed=$("$ROOT/node_modules/.bin/aleo-devnode" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo 'not installed')
report 'aleo-devnode (installed)' "$devnode_installed" "$devnode_latest"

# --- 4. aleo-dev-toolkit adaptor packages (npm) ---
# Exact pins live in packages/react (wallet UIs) and packages/wallet-adapter
# (-core dev dependency); wallet-adapter's "*" peer range is not a pin.
for pkg in core react shield leo puzzle fox; do
  latest=$(npm view "@provablehq/aleo-wallet-adaptor-$pkg" version 2>/dev/null || echo '?')
  current=$(grep -ho "\"@provablehq/aleo-wallet-adaptor-$pkg\": \"[0-9][^\"]*\"" \
    "$ROOT/packages/react/package.json" "$ROOT/packages/wallet-adapter/package.json" 2>/dev/null \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo '')
  [ -z "$current" ] && current='unpinned'
  report "aleo-wallet-adaptor-$pkg" "$current" "$latest"
done

exit $STALE
