/**
 * The conventions every trader script shares: flags, progress, output, and the
 * guard that stands between a plan and a transaction.
 *
 * Kept deliberately small. Each command is meant to be read top to bottom, so
 * the only thing hidden here is the plumbing that would otherwise be identical
 * in twelve files.
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
import { alarm, bold, dim, green, help as helpText, red, yellow } from './color.js'

/** Flags every script accepts, whatever else it adds. */
const COMMON = {
  network: { type: 'string' },
  execute: { type: 'boolean' },
  json: { type: 'boolean' },
  // `-h` is declared here rather than only on the dispatcher: `parseArgs` rejects
  // undeclared short options, so `shield-swap pools -h` failed with a usage error
  // while `shield-swap -h` printed the help. The two must not disagree.
  help: { type: 'boolean', short: 'h' },
  'no-color': { type: 'boolean' },
} as const

export type CommonFlags = {
  network?: string
  execute?: boolean
  json?: boolean
  help?: boolean
  'no-color'?: boolean
}

/**
 * Parses a command's arguments into the common flags plus its own.
 *
 * Unknown flags are an error rather than ignored: a mistyped `--amont` that
 * silently fell back to a default would submit a transaction the caller did not
 * describe.
 *
 * @param spec The command's own flags, in `parseArgs` option form.
 * @param usage Printed for `--help`, and on a parse error.
 * @param argv The arguments after the subcommand name, as the dispatcher passes
 *   them to `main`. Never `process.argv`, which still carries the subcommand
 *   itself and would fail `allowPositionals: false`.
 * @returns The parsed values, merged with the common flags.
 */
export function flags<T extends Record<string, { type: 'string' | 'boolean'; multiple?: boolean }>>(
  spec: T,
  usage: string,
  argv: string[],
): CommonFlags & Record<keyof T, string | boolean | string[] | undefined> {
  // Widened deliberately: parseArgs' generics describe the option table, and
  // threading that through this helper buys nothing a command uses.
  let values: Record<string, string | boolean | string[] | undefined>
  // Only the parse is guarded. A wider try would report any later failure as a
  // usage error, and would swallow the `--help` exit below.
  try {
    ;({ values } = parseArgs({
      options: { ...COMMON, ...spec },
      args: argv,
      allowPositionals: false,
    }) as { values: Record<string, string | boolean | string[] | undefined> })
  } catch (error) {
    reportUsage((error as Error).message, usage, argv)
  }

  if (values.help) {
    console.log(helpText(usage))
    process.exit(0)
  }
  return values as CommonFlags & Record<keyof T, string | boolean | string[] | undefined>
}

/**
 * Reads a basis-points flag, rejecting what the arithmetic downstream cannot take.
 *
 * `Number(flag)` yields `NaN` for a typo and a fraction for `0.5`, and neither
 * survives the floor calculation in `planSwap`: it multiplies by
 * `BigInt(10_000 - bps)`, which throws on both. Above 10000 the multiplier goes
 * negative, and below 0 the floor rises above the quote so every swap reverts for
 * demanding more than the pool offers. Checked here so the failure names the flag
 * and costs no network calls, rather than surfacing from inside a plan.
 *
 * @param value The raw flag, or `undefined` when it was not passed.
 * @param flag The flag's name, for the error.
 * @returns The parsed basis points, or `undefined` to leave the default in place.
 */
export function basisPoints(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const bps = Number(value)
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    fail(`${flag} takes a whole number of basis points between 0 and 10000, got "${value}". 50 is 0.5%.`)
  }
  return bps
}

/**
 * Reports a malformed invocation and exits `64` (`EX_USAGE`).
 *
 * Used for failures that happen before {@link setJsonMode} can run — an unknown
 * subcommand, or a flag `parseArgs` rejects — so `--json` is read straight from
 * the arguments. A caller that asked for JSON must not get a usage block on
 * stderr and an empty stdout, which is indistinguishable from a crash.
 *
 * @param message What is wrong with the invocation.
 * @param usage The usage block to show alongside it.
 * @param argv The arguments as received, inspected only for `--json`.
 */
export function reportUsage(message: string, usage: string, argv: string[]): never {
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ error: { message, usage } }, null, 2))
  } else {
    // The message is the failure; the usage below it is reference material, so
    // only the latter is styled — and never the JSON branch above.
    console.error(`${red(message, 'stderr')}\n\n${helpText(usage)}`)
  }
  process.exit(64)
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
  // The whole line is dimmed: progress is scaffolding, and it should recede once
  // the result it was narrating arrives.
  if (!quiet) console.log(dim(`· ${message}`))
}

/** Prints a completed step. */
export function done(message: string): void {
  // Marker only. Colouring the message too would put half the output in green and
  // leave nothing for it to stand out against.
  if (!quiet) console.log(`${green('✓')} ${message}`)
}

/** Prints a warning that does not stop the script. */
export function warn(message: string): void {
  if (!quiet) console.warn(yellow(`! ${message}`, 'stderr'))
}

/**
 * Counts the columns text occupies, ignoring ANSI styling.
 *
 * A style is ESC [ … m and prints nothing, so measuring the raw string would
 * count bytes that take no space and shift every column right of a coloured cell.
 */
function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*m/g, '').length
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
 * Prints rows under a header, each column sized to its widest cell.
 *
 * Every script that lists things prints the same shape, and the part worth
 * getting right once is the width: a column narrower than its own header lets
 * the header spill into the next one, which silently misaligns the whole table.
 *
 * Numbers are right-aligned and labels left-aligned by default, since that is
 * what makes magnitudes comparable down a column. Amounts that need their
 * decimal points aligned should be padded by the caller before they arrive here
 * — this pads cells, it does not parse them.
 *
 * @param headers Column headings, also the minimum width of each column.
 * @param rows One array of cells per row, in header order. Short rows are padded
 *   with empty cells rather than throwing.
 * @param align Per-column alignment. Defaults to the first column left and the
 *   rest right; pass explicitly when a trailing id or status reads better left.
 */
export function table(
  headers: string[],
  rows: string[][],
  align?: ReadonlyArray<'left' | 'right'>,
): void {
  const cells = rows.map((row) => headers.map((_, i) => row[i] ?? ''))
  // Measured without styling: a coloured cell carries escape codes that occupy no
  // columns, so `padEnd` on the raw string would indent every later column by the
  // length of the codes.
  const widths = headers.map((header, i) => Math.max(header.length, ...cells.map((row) => visibleWidth(row[i]!))))
  const side = (i: number) => align?.[i] ?? (i === 0 ? 'left' : 'right')
  const pad = (cell: string, i: number) => {
    const fill = ' '.repeat(Math.max(0, widths[i]! - visibleWidth(cell)))
    return side(i) === 'left' ? cell + fill : fill + cell
  }
  const line = (row: string[]) => `  ${row.map(pad).join('   ')}`.trimEnd()

  console.log('')
  console.log(bold(line(headers)))
  console.log(dim(`  ${widths.map((w) => '─'.repeat(w)).join('   ')}`))
  for (const row of cells) console.log(line(row))
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
 * @param options.plan Label/value pairs describing exactly what would happen,
 *   rendered as a table. An empty label continues the row above it, which is how
 *   a two-sided amount states its second side.
 * @returns `true` when the caller should proceed.
 */
export function confirmed(options: {
  execute?: boolean
  network: string
  plan: ReadonlyArray<readonly [string, string]>
}): boolean {
  // The network heads the value column rather than sitting in a sentence above
  // it, so the one thing worth double-checking before spending is level with the
  // amounts being spent.
  const banner =
    options.network === 'mainnet' ? alarm('MAINNET — real funds') : dim(options.network)
  if (!quiet) {
    table(
      ['PLAN', banner],
      options.plan.map(([label, value]) => [label, value]),
      ['left', 'left'],
    )
  }
  if (options.execute) return true
  if (!quiet) console.log(dim('\nnothing submitted. re-run with --execute to send it.\n'))
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
    reportError(err.message, err.cause)
    process.exitCode = 1
  }
}

/**
 * Renders a failure on the channel the caller asked for.
 *
 * Under --json the failure has to arrive as an object too: a message on stderr
 * with nothing on stdout leaves a caller that parses stdout with an empty string
 * and no way to tell a failure from a script that found nothing.
 *
 * @param message What went wrong, already written to be actionable.
 * @param cause The underlying error when the SDK chained one.
 */
function reportError(message: string, cause?: unknown): void {
  if (quiet) {
    console.log(
      JSON.stringify(
        { error: { message, ...(cause instanceof Error ? { cause: cause.message } : {}) } },
        null,
        2,
      ),
    )
    return
  }
  console.error(`\n${red('✗', 'stderr')} ${message}`)
  if (cause instanceof Error) console.error(dim(`  caused by: ${cause.message}`))
}

/**
 * Reports a failure and exits, for checks that run before {@link run}.
 *
 * Flag validation happens at the top of `main`, outside `run`'s try — a bare
 * `throw` there reaches the dispatcher as an unhandled rejection and prints a
 * Node stack trace, which carries no JSON and buries the one line the caller
 * needs. Returns `never`, so TypeScript narrows the checked value afterwards.
 *
 * @param message What is wrong with the invocation.
 * @param cause The underlying error, when there is one.
 */
export function fail(message: string, cause?: unknown): never {
  reportError(message, cause)
  process.exit(1)
}
