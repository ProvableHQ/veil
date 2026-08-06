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
import { help, setNoColor } from './color.js'

const [name, ...argv] = process.argv.slice(2)

// Both set before dispatch rather than inside each command: `--json` promises one
// object on stdout and nothing else, and a command that reported progress before
// reaching its own `setJsonMode` would already have broken that. `--no-color` has
// to be in place before the first line for the same reason.
setJsonMode(argv.includes('--json'))
setNoColor(argv.includes('--no-color'))

if (!name || name === '--help' || name === '-h' || name === 'help') {
  // Exit 0 for a bare invocation too: listing the commands is what someone
  // running `shield-swap` with nothing wants, and it is the first thing anyone
  // types. EX_USAGE there makes the wrapper report a failed command — `pnpm
  // shield-swap` printing the help and then `ELIFECYCLE Command failed` reads as
  // a broken install. A wrong command still exits 64, below.
  console.log(help(usage()))
  process.exit(0)
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
