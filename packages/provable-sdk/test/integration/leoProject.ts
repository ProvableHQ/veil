import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLeoClient } from '@veil/leo'

/** A scaffolded and compiled Leo program: the project dir and the compiled Aleo instructions. */
export type BuiltLeoProgram = { dir: string; compiled: string }

/**
 * Scaffolds a Leo project in a tmpdir, builds it, and returns the project dir
 * plus the compiled Aleo instructions. Leo ≥4.3 writes build artifacts to
 * `build/<name>/<name>.aleo`. The caller removes `dir` when done.
 */
export async function buildLeoProgram(programName: string, source: string): Promise<BuiltLeoProgram> {
  const dir = mkdtempSync(join(tmpdir(), 'veil-leo-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'main.leo'), source)
  writeFileSync(
    join(dir, 'program.json'),
    JSON.stringify({ program: programName, version: '0.0.0', description: 'veil e2e test program', license: 'MIT' }, null, 2),
  )
  const leoClient = createLeoClient({ cwd: dir })
  await leoClient.build()
  const nameNoExt = programName.replace(/\.aleo$/, '')
  const compiled = readFileSync(join(dir, 'build', nameNoExt, `${nameNoExt}.aleo`), 'utf-8')
  return { dir, compiled }
}
