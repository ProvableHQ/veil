/**
 * The conventions every trader script shares: flags, progress, output, and the
 * guard that stands between a plan and a transaction.
 *
 * Kept deliberately small. Each script is meant to be read top to bottom and
 * copied out, so the only thing hidden here is the plumbing that would
 * otherwise be identical in twelve files.
 *
 * Three rules hold everywhere:
 *
 *   1. Nothing spends money without `--execute`. Every script prints its plan
 *      and stops, so a first run is always safe.
 *   2. `--network mainnet` must be explicit. Mainnet is never a default.
 *   3. `--json` prints one machine-readable object on stdout and nothing else,
 *      so an agent or a pipeline can drive the same script a person uses.
 */
import { parseArgs } from 'node:util'

/** Flags every script accepts, whatever else it adds. */
const COMMON = {
  network: { type: 'string' },
  execute: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
} as const

export type CommonFlags = {
  network?: string
  execute?: boolean
  json?: boolean
  help?: boolean
}

/**
 * Parses the command line into the common flags plus a script's own.
 *
 * Unknown flags are an error rather than ignored: a mistyped `--amont` that
 * silently fell back to a default would submit a transaction the caller did not
 * describe.
 *
 * @param spec The script's own flags, in `parseArgs` option form.
 * @param usage Printed for `--help`, and on a parse error.
 * @returns The parsed values, merged with the common flags.
 */
export function flags<T extends Record<string, { type: 'string' | 'boolean'; multiple?: boolean }>>(
  spec: T,
  usage: string,
): CommonFlags & Record<keyof T, string | boolean | string[] | undefined> {
  try {
    // Widened deliberately: parseArgs' generics describe the option table, and
    // threading that through this helper buys nothing a script uses.
    const { values } = parseArgs({ options: { ...COMMON, ...spec }, allowPositionals: false }) as {
      values: Record<string, string | boolean | string[] | undefined>
    }
    if (values.help) {
      console.log(usage)
      process.exit(0)
    }
    return values as CommonFlags & Record<keyof T, string | boolean | string[] | undefined>
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${usage}`)
    process.exit(64) // EX_USAGE
  }
}

/** True when the script should print machine-readable output only. */
let quiet = false

/** Silences progress so `--json` emits exactly one object. */
export function setJsonMode(on: boolean): void {
  quiet = on
}

/**
 * Prints a progress line, unless `--json` asked for silence.
 *
 * These scripts wait on proving and confirmation for tens of seconds at a time.
 * Without narration a human cannot tell a slow step from a hung one, and an
 * agent has nothing to report back.
 */
export function step(message: string): void {
  if (!quiet) console.log(`· ${message}`)
}

/** Prints a completed step. */
export function done(message: string): void {
  if (!quiet) console.log(`✓ ${message}`)
}

/** Prints a warning that does not stop the script. */
export function warn(message: string): void {
  if (!quiet) console.warn(`! ${message}`)
}

/**
 * Prints the result: the JSON object under `--json`, otherwise the human lines.
 *
 * @param data The machine-readable result.
 * @param human Called instead when a person is reading. Receives the same data.
 */
export function output<T>(data: T, human: (data: T) => void): void {
  if (quiet) {
    console.log(JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2))
    return
  }
  human(data)
}

/**
 * Stops before spending unless `--execute` was passed.
 *
 * The plan is printed either way, so the dry run and the real run differ only in
 * whether a transaction follows. On mainnet the network is named in the plan
 * because the same command against the wrong network is the expensive mistake.
 *
 * @param options.execute Whether `--execute` was passed.
 * @param options.network The resolved network.
 * @param options.plan Lines describing exactly what would happen.
 * @returns `true` when the caller should proceed.
 */
export function confirmed(options: { execute?: boolean; network: string; plan: string[] }): boolean {
  const banner = options.network === 'mainnet' ? 'MAINNET — real funds' : options.network
  if (!quiet) {
    console.log(`\nplan (${banner}):`)
    for (const line of options.plan) console.log(`  ${line}`)
  }
  if (options.execute) return true
  if (!quiet) console.log('\nnothing submitted. re-run with --execute to send it.\n')
  return false
}

/**
 * Runs a script's body, reporting a failure as a line rather than a stack.
 *
 * A trader reading a wall of frames learns less than they would from the
 * message, and every error these scripts surface is written to be actionable.
 * The cause chain is printed when there is one, because the SDK attaches the
 * underlying failure rather than replacing it.
 */
export async function run(main: () => Promise<void>): Promise<void> {
  try {
    await main()
  } catch (error) {
    const err = error as Error & { cause?: unknown }
    console.error(`\n✗ ${err.message}`)
    if (err.cause instanceof Error) console.error(`  caused by: ${err.cause.message}`)
    process.exitCode = 1
  }
}
