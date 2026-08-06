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
import { dim, green, greenBright, greenDim } from '../color.js'

const USAGE = `shield-swap balances — private and public holdings per token

  --network <testnet|mainnet>   default testnet
  --token <symbol|id>           only this token
  --all                         include tokens with a zero balance
  --json                        machine-readable output`

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
      // Printed as formatted, with no padding of their own. Aligning on the decimal
      // point instead would pad each integer part out to the widest one, and in a
      // left-aligned column that pad becomes a visible indent — the points would
      // line up while the numbers started at three different places.
      table(
        ['TOKEN', 'PRIVATE', 'PUBLIC', 'TOTAL', 'TOKEN ID'],
        // Green throughout, because every figure here is money the account holds.
        // The private side is brightest: it is the only one a swap can spend, so a
        // reader deciding whether a trade is possible wants it to stand out from a
        // public balance that has to be wrapped or transferred first.
        data.tokens.map((row) => [
          row.symbol,
          greenBright(formatAmount(row.private, row.decimals)),
          greenDim(formatAmount(row.public, row.decimals)),
          green(formatAmount(row.total, row.decimals)),
          dim(row.id),
        ]),
        // Left throughout: the amounts already line up on their decimal points, and
        // ragging them against the right edge of a wide header only pushed them away
        // from the token they belong to.
        ['left', 'left', 'left', 'left', 'left'],
      )
    })
  })
}
