import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/node.ts', 'src/agent/index.ts', 'src/mcp/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
