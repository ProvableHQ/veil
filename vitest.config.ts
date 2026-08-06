import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts', 'examples/*.ts', 'examples/**/*.test.ts'],
    typecheck: {
      // `*.test-d.ts` files assert type-level behaviour that no other check
      // covers: package tsconfigs are `include: ["src"]`, so `tsc --noEmit`
      // never reads `test/`, and a `@ts-expect-error` there would pass silently.
      // Run them with `pnpm vitest --typecheck.only run`.
      include: ['packages/*/test/**/*.test-d.ts'],
      // Report only errors inside those files. The rest of the test tree has
      // never been typechecked and currently has ~200 pre-existing errors;
      // fixing those is its own change, and blocking on them would mean these
      // assertions never run at all.
      ignoreSourceErrors: true,
    },
    onConsoleLog(log) {
      // Suppress SDK deployment noise: program-existence checks hit /latest_edition
      // and /amendment_count which return 500 on the devnode, causing retries and
      // status spam.
      if (/does not exist on the network|Creating deployment|Checking program|Importing program|Adding \S+ to the process|Error - \d+ .* retrying in|No network specified|No endpoint specified|Authorizing \S+\/fee_public|Loading the SnarkVM process|Check program imports|parsing inputs|Error finding edition\/amendment/.test(log)) return false
    },
  },
  resolve: {
    alias: {
      '@provablehq/veil-core/agent': path.resolve(__dirname, 'packages/core/src/agent/index.ts'),
      '@provablehq/veil-core/mcp': path.resolve(__dirname, 'packages/core/src/mcp/index.ts'),
      '@provablehq/veil-core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      // The CLI imports the SDK by name. Without these it would resolve through
      // node_modules to `dist`, so a test could pass against a stale build.
      '@provablehq/shield-swap-sdk/agent': path.resolve(__dirname, 'packages/shield-swap/src/agent/index.ts'),
      '@provablehq/shield-swap-sdk/mcp': path.resolve(__dirname, 'packages/shield-swap/src/mcp/index.ts'),
      '@provablehq/shield-swap-sdk/node': path.resolve(__dirname, 'packages/shield-swap/src/node.ts'),
      '@provablehq/shield-swap-sdk': path.resolve(__dirname, 'packages/shield-swap/src/index.ts'),
      '@provablehq/veil-aleo-bridges/agent': path.resolve(__dirname, 'packages/bridge/src/agent/index.ts'),
      '@provablehq/veil-aleo-bridges/mcp': path.resolve(__dirname, 'packages/bridge/src/mcp/index.ts'),
      '@provablehq/veil-aleo-bridges': path.resolve(__dirname, 'packages/bridge/src/index.ts'),
      '@provablehq/veil-aleo-wallet-adapter': path.resolve(__dirname, 'packages/wallet-adapter/src/index.ts'),
      // Subpaths first: these aliases are prefix-matched in order, so the bare
      // package name would otherwise swallow `/node` and resolve it to the root.
      '@provablehq/veil-aleo-sdk/node': path.resolve(__dirname, 'packages/provable-sdk/src/node.ts'),
      '@provablehq/veil-aleo-sdk': path.resolve(__dirname, 'packages/provable-sdk/src/index.ts'),
      '@provablehq/veil-leo': path.resolve(__dirname, 'packages/leo/src/index.ts'),
      '@provablehq/veil-aleo-devnode': path.resolve(__dirname, 'packages/devnode/src/index.ts'),
    },
  },
})
