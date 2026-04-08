import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/*/test/**/*.test.ts', 'examples/**/*.ts'],
  },
  resolve: {
    alias: {
      '@veil/core/agent': path.resolve(__dirname, 'packages/core/src/agent/index.ts'),
      '@veil/core/mcp': path.resolve(__dirname, 'packages/core/src/mcp/index.ts'),
      '@veil/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@veil/wallet-adapter': path.resolve(__dirname, 'packages/wallet-adapter/src/index.ts'),
      '@veil/provable': path.resolve(__dirname, 'packages/provable/src/index.ts'),
    },
  },
})
