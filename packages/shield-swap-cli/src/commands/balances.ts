/**
 * Balances — what the account holds, private and public, per token.
 *
 * The private side is what funds trades: swaps and mints spend private records,
 * and a freshly funded account shows zero public balance because the faucet
 * delivers records. Both sides come from `getBalances`, which reconciles the
 * token registry against the record scanner and the API.
 *
 * Reads only. Spends nothing.
 *
 * Usage:
 *   shield-swap balances                     # testnet
 *   shield-swap balances --network mainnet
 *   shield-swap balances --token USDCx       # one token
 *   shield-swap balances --all               # include zero balances
 *   shield-swap balances --json
 */
import { loadSession, formatAmount } from '../session.js'
import { flags, step, done, output, run, table } from '../shared.js'

const USAGE = `shield-swap balances — private and public holdings per token

  --network <testnet|mainnet>   default testnet
  --token <symbol|id>           only this token
  --all                         include tokens with a zero balance
  --json                        machine-readable output`

/**
 * Renders one numeric column with its decimal points aligned.
 *
 * Token decimals run from 6 to 18 in the same table, so a single right-aligned
 * column puts `0.4` and `0.000933727587783733` on different visual scales and
 * neither reads as a magnitude. Aligning on the point makes the integer parts
 * line up and the fractions hang off the same edge, so the eye compares sizes
 * rather than string lengths. Pure and local.
 *
 * @param values Formatted decimal strings, thousands separators included.
 * @returns The same values, each padded to a common width.
 */
function alignDecimals(values: string[]): string[] {
  const split = values.map((v) => {
    const [whole = '0', fraction = ''] = v.split('.')
    return { whole, fraction }
  })
  const wholeWidth = Math.max(...split.map((s) => s.whole.length))
  const fractionWidth = Math.max(...split.map((s) => s.fraction.length))
  return split.map(({ whole, fraction }) => {
    // The point only appears when there is a fraction, so a whole number keeps
    // its column without a trailing dot.
    const tail = fraction ? `.${fraction}` : ''
    return `${whole.padStart(wholeWidth)}${tail.padEnd(fractionWidth ? fractionWidth + 1 : 0)}`
  })
}

/**
 * Runs the `balances` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags({ token: { type: 'string' }, all: { type: 'boolean' } }, USAGE, argv)

  await run(async () => {
    const { client, account, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network} for ${account.address}`)

    const only = args.token ? await client.tokenData(args.token as string) : undefined
    step('scanning records and reading public balances')
    // getBalances returns only what the account holds unless asked for specific
    // tokens, so `--all` has to name the whole registry — filtering a map that
    // never contained the zero rows would drop them silently.
    const scope = only
      ? [only.id]
      : args.all
        ? (await client.listTokens()).map((token) => token.id)
        : undefined
    const balances = await client.getBalances(scope ? { tokens: scope } : {})

    const rows = Object.entries(balances)
      .map(([id, entry]) => ({ id, ...entry }))
      .filter((row) => args.all || row.total > 0n)
      .sort((a, b) => a.symbol.localeCompare(b.symbol))

    output({ network, address: account.address, tokens: rows }, (data) => {
      if (!data.tokens.length) {
        console.log('\nNo balances. Fund the account (testnet: `shield-swap setup`) and try again.')
        return
      }
      // Aligned before they reach the table, which pads cells without parsing them.
      const priv = alignDecimals(data.tokens.map((r) => formatAmount(r.private, r.decimals)))
      const pub = alignDecimals(data.tokens.map((r) => formatAmount(r.public, r.decimals)))
      const total = alignDecimals(data.tokens.map((r) => formatAmount(r.total, r.decimals)))
      table(
        ['TOKEN', 'PRIVATE', 'PUBLIC', 'TOTAL', 'TOKEN ID'],
        data.tokens.map((row, i) => [row.symbol, priv[i]!, pub[i]!, total[i]!, row.id]),
        ['left', 'right', 'right', 'right', 'left'],
      )
    })
  })
}
