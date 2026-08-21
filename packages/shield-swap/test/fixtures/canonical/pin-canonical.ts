/**
 * Refreshes the vendored canonical token-program bytecode.
 *
 * Fetches each pinned program from the Explorer, verifies its SHA-256 and
 * parsed id against `canonicalPrograms.ts`, and writes it to `<id>.aleo` beside
 * that module. The written files are committed, so the devnode fixture reads
 * bytecode from disk and needs no network access.
 *
 * A SHA-256 mismatch aborts without writing: the deployment moved, and the
 * pinned edition, hash, and adaptation occurrence counts all need review
 * before the pin changes.
 *
 * Run from the repo root:
 *   pnpm tsx packages/shield-swap/test/fixtures/canonical/pin-canonical.ts
 */

import { writeFileSync } from 'node:fs'

import {
  CANONICAL_PROGRAM_SPECS,
  canonicalProgramPath,
  fetchCanonicalProgram,
} from './canonicalPrograms.js'

async function main(): Promise<void> {
  for (const spec of CANONICAL_PROGRAM_SPECS) {
    const source = await fetchCanonicalProgram(spec)
    const path = canonicalProgramPath(spec)
    writeFileSync(path, source)
    console.log(`pinned ${spec.id} edition ${spec.edition} (${spec.sha256}) -> ${path}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
