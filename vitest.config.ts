import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts', 'examples/*.ts', 'examples/**/*.test.ts'],
    onConsoleLog(log) {
      // Suppress SDK deployment noise: program-existence checks hit /latest_edition
      // which returns 500 on the devnode, causing retries and status spam.
      if (/does not exist on the network|Creating deployment|Checking program|Importing program|Adding \S+ to the process|Error - \d+ .* retrying in|No network specified|No endpoint specified|Authorizing \S+\/fee_public|Loading the SnarkVM process|Check program imports|parsing inputs/.test(log)) return false
    },
  },
  resolve: {
    alias: {
      '@veil/core/agent': path.resolve(__dirname, 'packages/core/src/agent/index.ts'),
      '@veil/core/mcp': path.resolve(__dirname, 'packages/core/src/mcp/index.ts'),
      '@veil/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@veil/wallet-adapter': path.resolve(__dirname, 'packages/wallet-adapter/src/index.ts'),
      '@veil/provable-sdk': path.resolve(__dirname, 'packages/provable-sdk/src/index.ts'),
      '@veil/leo': path.resolve(__dirname, 'packages/leo/src/index.ts'),
      '@veil/devnode': path.resolve(__dirname, 'packages/devnode/src/index.ts'),
    },
  },
})
