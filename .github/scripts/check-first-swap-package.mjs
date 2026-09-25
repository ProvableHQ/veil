import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageDirectory = fileURLToPath(new URL('../../packages/shield-swap/', import.meta.url))
const [archive] = JSON.parse(execFileSync('npm', [
  'pack', '--dry-run', '--json', '--ignore-scripts',
], { cwd: packageDirectory, encoding: 'utf8' }))
const files = archive.files.map(({ path }) => path)
const example = 'examples/first-swap/'
for (const name of ['README.md', 'package.json', 'package-lock.json', 'swap.ts', 'state.ts', 'state.test.ts', 'tsconfig.json']) {
  assert.ok(files.includes(`${example}${name}`), `Missing packaged example file: ${name}`)
}
assert.ok(!files.some((path) => /(?:^|\/)\.state(?:\/|$)/.test(path)), 'Account state must not be packaged')
assert.ok(!files.some((path) => /(?:^|\/)node_modules(?:\/|$)/.test(path)), 'Example dependencies must not be packaged')
