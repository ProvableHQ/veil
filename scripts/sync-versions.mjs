// Syncs each package's `src/version.ts` constant with its `package.json`
// version. Runs after `changeset version` so the constant the SDK embeds in
// its client header never drifts from the published version; the transport
// test suite fails on drift as a backstop.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(root, 'packages')

let failed = false
for (const entry of readdirSync(packagesDir)) {
  const versionFile = join(packagesDir, entry, 'src', 'version.ts')
  if (!existsSync(versionFile)) continue

  const pkg = JSON.parse(readFileSync(join(packagesDir, entry, 'package.json'), 'utf8'))
  const source = readFileSync(versionFile, 'utf8')

  // A version.ts the pattern no longer matches (reformatted quotes, renamed
  // constant) cannot be synced. Fail hard rather than let a stale version ship.
  const pattern = /export const version = '[^']*'/
  if (!pattern.test(source)) {
    console.error(`sync-versions: ${entry}/src/version.ts does not match the expected shape; update it to ${pkg.version} manually`)
    failed = true
    continue
  }
  const synced = source.replace(pattern, `export const version = '${pkg.version}'`)
  if (synced !== source) {
    writeFileSync(versionFile, synced)
    console.log(`sync-versions: ${entry}/src/version.ts → ${pkg.version}`)
  }
}
if (failed) process.exit(1)
