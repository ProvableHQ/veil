#!/usr/bin/env node
/**
 * The `shield-swap` command: account setup, pool and balance reads, swaps, and
 * liquidity, against a live Shield Swap deployment.
 *
 * This file only routes. Each subcommand owns its own flags, its own `--help`,
 * and its own output; the registry that names them lives in `registry.ts`.
 *
 * Two rules hold across every subcommand and are enforced in `shared.ts`:
 * nothing spends without `--execute`, and mainnet is never implicit.
 */
import { COMMANDS, usage } from './registry.js'
import { reportUsage, setJsonMode } from './shared.js'

const [name, ...argv] = process.argv.slice(2)

// Set before dispatch rather than inside each command: `--json` promises one
// object on stdout and nothing else, and a command that reported progress before
// reaching its own `setJsonMode` would already have broken that.
setJsonMode(argv.includes('--json'))

if (!name || name === '--help' || name === '-h' || name === 'help') {
  console.log(usage())
  process.exit(name ? 0 : 64) // EX_USAGE when invoked with nothing at all
}

const command = COMMANDS[name]
if (!command) {
  // Suggest rather than just reject: the subcommand names are close enough to
  // each other that a near miss is far more likely than an invented one.
  const near = Object.keys(COMMANDS).filter((candidate) => candidate.startsWith(name) || name.startsWith(candidate))
  reportUsage(
    `unknown command \`${name}\`.${near.length ? ` Did you mean \`${near.join('` or `')}\`?` : ''}`,
    usage(),
    argv,
  )
}

const { main } = await command.load()
await main(argv)
