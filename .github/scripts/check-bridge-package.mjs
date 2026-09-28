import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'packages/bridge/package.json'), 'utf8'))
const temporary = mkdtempSync(join(tmpdir(), 'veil-bridge-package-'))
try {
  // Install real archives outside the workspace so aliases cannot hide missing files.
  // Include the SDK's devnode peer so unpublished release versions install locally.
  for (const name of ['core', 'devnode', 'provable-sdk', 'bridge']) {
    execFileSync('pnpm', ['pack', '--pack-destination', temporary], {
      cwd: join(root, 'packages', name), stdio: 'pipe',
    })
  }
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  const archives = readdirSync(temporary).filter((name) => name.endsWith('.tgz'))
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund',
    ...archives.map((name) => join(temporary, name)),
    `@provablehq/sdk@${manifest.devDependencies['@provablehq/sdk']}`,
    `@solana/kit@${manifest.devDependencies['@solana/kit']}`,
    `viem@${manifest.dependencies.viem}`,
    'typescript@~5.7.3', '@types/node@^22', 'tsx@^4.21.0'], {
    cwd: temporary, stdio: 'inherit',
  })
  const require = createRequire(join(temporary, 'package.json'))
  const guide = require.resolve('@provablehq/aleo-bridge-sdk/skills/SKILL.md')
  assert.match(readFileSync(guide, 'utf8'), /examples\/README.md/)
  const tutorial = require.resolve('@provablehq/aleo-bridge-sdk/examples/README.md')
  const source = join(root, 'packages/bridge/examples')
  for (const name of readdirSync(source).filter((name) => name.endsWith('.ts'))) {
    const installed = require.resolve(`@provablehq/aleo-bridge-sdk/examples/${name}`)
    assert.equal(readFileSync(installed, 'utf8'), readFileSync(join(source, name), 'utf8'))
  }
  const examples = join(temporary, 'bridge-examples')
  cpSync(dirname(tutorial), examples, { recursive: true })
  execFileSync(join(temporary, 'node_modules/.bin/tsc'), ['--noEmit', '-p', examples], {
    cwd: temporary, stdio: 'inherit',
  })
  // Load the public SDK and both shared helpers without running a live transfer.
  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "await import('@provablehq/aleo-bridge-sdk'); await import('./bridge-examples/ethereum-hyperlane.ts'); await import('./bridge-examples/aleo-hyperlane.ts')"], {
    cwd: temporary, stdio: 'inherit',
  })
  console.log('Installed bridge guide, all example sources, typecheck, and helper imports passed.')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
