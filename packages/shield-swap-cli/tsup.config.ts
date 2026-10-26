import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/session.ts', 'src/storage.ts'],
  format: ['esm'],
  // node:sqlite has no bare 'sqlite' alias; retain the protocol in built imports.
  removeNodeProtocol: false,
  dts: true,
  clean: true,
  sourcemap: true,
})
