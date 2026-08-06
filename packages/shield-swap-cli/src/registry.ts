/**
 * The subcommand registry and the top-level usage block.
 *
 * Separate from `index.ts` so it can be imported without running the
 * dispatcher: `index.ts` reads `process.argv` and exits at module scope, which
 * makes it unimportable from anything that is not the binary itself.
 */

/**
 * One subcommand: what it does, and how to load it.
 *
 * @property summary One line for the top-level listing. No trailing period is
 *   added, so write it as a sentence.
 * @property load Imports the command's module. A thunk rather than a static
 *   import so an unused command — and the SDK surface it pulls in — is never
 *   evaluated.
 */
export type Command = {
  summary: string
  load: () => Promise<{ main: (argv: string[]) => Promise<void> }>
}

/**
 * Every subcommand, in the order the README recommends running them.
 *
 * The single place a subcommand is declared: adding a key here is what makes it
 * reachable, listed in `--help`, and covered by the registry test.
 */
export const COMMANDS: Record<string, Command> = {
  setup: {
    summary: 'Set up all credentials required for Shield Swap.',
    load: () => import('./commands/setup.js'),
  },
  pools: {
    summary: 'List pools with their on-chain depth and whether they are tradeable.',
    load: () => import('./commands/pools.js'),
  },
  balances: {
    summary: 'Private and public holdings per token.',
    load: () => import('./commands/balances.js'),
  },
  positions: {
    summary: 'Liquidity positions held + their ranges and fees earned (with option to collect).',
    load: () => import('./commands/positions.js'),
  },
  swap: {
    summary: 'Sell one token for another and claim the output.',
    load: () => import('./commands/swap.js'),
  },
  'swap-concurrent': {
    summary: 'Make multiple swaps concurrently.',
    load: () => import('./commands/swap-concurrent.js'),
  },
  history: {
    summary: 'Swap history and status of swaps.',
    load: () => import('./commands/swap-history.js'),
  },
  mint: {
    summary: 'Open a liquidity position over a tick range.',
    load: () => import('./commands/mint.js'),
  },
  liquidity: {
    summary: 'Add to an open position, or remove liquidity and book it as owed.',
    load: () => import('./commands/liquidity.js'),
  },
  collect: {
    summary: 'Sweep what a position is owed into records, optionally closing it.',
    load: () => import('./commands/collect.js'),
  },
  'liquidity-e2e': {
    summary: 'The whole liquidity lifecycle in one run — mint through burn.',
    load: () => import('./commands/liquidity-e2e.js'),
  },
}

/**
 * Builds the top-level usage block, with the summaries aligned in a column.
 *
 * @returns The block printed for `shield-swap`, `--help`, and an unknown command.
 */
export function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length))
  const lines = Object.entries(COMMANDS).map(([name, { summary }]) => `  ${name.padEnd(width)}  ${summary}`)
  return `shield-swap — trade on Shield Swap from the command line

Usage: shield-swap <command> [options]

${lines.join('\n')}

Run \`shield-swap <command> --help\` for a command's own flags.

Common to every command below setup:
  --network <testnet|mainnet>   default testnet; mainnet is never implicit
  --execute                     actually submit; without it, plans and stops
  --json                        one machine-readable object, nothing else
  --no-color                    plain output; NO_COLOR and a non-TTY do this too
  -h, --help                    this text, or a command's own when it follows one

setup takes --network and its own options, but neither --execute nor --json:
it is check-then-act throughout and reports progress as text.`
}
