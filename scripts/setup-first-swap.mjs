import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const example = join(root, 'packages/shield-swap/examples/first-swap')
const archives = mkdtempSync(join(tmpdir(), 'veil-first-swap-'))
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' })

try {
  // Test the checkout through published-package boundaries, without changing pins.
  run('pnpm', ['install', '--frozen-lockfile'])
  run('pnpm', ['--filter', '@provablehq/shield-swap-sdk...', '--filter', '@provablehq/veil-aleo-sdk...', 'build'])
  for (const name of ['veil-core', 'veil-aleo-sdk', 'shield-swap-sdk']) {
    run('pnpm', ['--filter', `@provablehq/${name}`, 'pack', '--pack-destination', archives])
  }
  run('npm', ['ci'], example)
  run('npm', ['install', '--no-save', '--package-lock=false',
    ...readdirSync(archives).filter((name) => name.endsWith('.tgz')).map((name) => join(archives, name)),
  ], example)
  run('npm', ['run', 'typecheck'], example)
  console.log('\nReady. Run the example with:\n  cd packages/shield-swap/examples/first-swap\n  npm start')
} finally {
  // Account keys and recovery files remain in the example directory.
  rmSync(archives, { recursive: true, force: true })
}
