import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts', 'examples/*.ts', 'examples/**/*.test.ts'],
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
      '@provablehq/veil-aleo-bridges/agent': path.resolve(__dirname, 'packages/bridge/src/agent/index.ts'),
      '@provablehq/veil-aleo-bridges/mcp': path.resolve(__dirname, 'packages/bridge/src/mcp/index.ts'),
      '@provablehq/veil-aleo-bridges': path.resolve(__dirname, 'packages/bridge/src/index.ts'),
      '@provablehq/veil-aleo-wallet-adapter': path.resolve(__dirname, 'packages/wallet-adapter/src/index.ts'),
      '@provablehq/veil-aleo-sdk': path.resolve(__dirname, 'packages/provable-sdk/src/index.ts'),
      '@provablehq/veil-leo': path.resolve(__dirname, 'packages/leo/src/index.ts'),
      '@provablehq/veil-aleo-devnode': path.resolve(__dirname, 'packages/devnode/src/index.ts'),
    },
  },
})
