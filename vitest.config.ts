import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts', 'examples/**/*.ts'],
  },
  resolve: {
    alias: {
      '@aleo-viem/core/agent': path.resolve(__dirname, 'packages/core/src/agent/index.ts'),
      '@aleo-viem/core/mcp': path.resolve(__dirname, 'packages/core/src/mcp/index.ts'),
      '@aleo-viem/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@aleo-viem/wallet-adapter': path.resolve(__dirname, 'packages/wallet-adapter/src/index.ts'),
      '@aleo-viem/provable': path.resolve(__dirname, 'packages/provable/src/index.ts'),
    },
  },
})
