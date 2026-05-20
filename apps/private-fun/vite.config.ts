import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    // Solana/Anchor/pump-sdk expect Node's `Buffer` and `process` globals.
    // This plugin polyfills them in the browser.
    nodePolyfills({
      include: ['buffer', 'process', 'crypto', 'stream', 'util'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      '@veil/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@veil/bridge': path.resolve(__dirname, '../../packages/bridge/src/index.ts'),
      '@veil/react': path.resolve(__dirname, '../../packages/react/src/index.ts'),
      '@veil/wallet-adapter': path.resolve(__dirname, '../../packages/wallet-adapter/src/index.ts'),
    },
  },
})
