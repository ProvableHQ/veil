import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@veil/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@veil/bridge': path.resolve(__dirname, '../../packages/bridge/src/index.ts'),
      '@veil/react': path.resolve(__dirname, '../../packages/react/src/index.ts'),
      '@veil/wallet-adapter': path.resolve(__dirname, '../../packages/wallet-adapter/src/index.ts'),
    },
  },
})
