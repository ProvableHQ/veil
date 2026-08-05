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
 *   npx tsx balances.ts                     # testnet
 *   npx tsx balances.ts --network mainnet
 *   npx tsx balances.ts --token USDCx       # one token
 *   npx tsx balances.ts --all               # include zero balances
 *   npx tsx balances.ts --json
 */
import { loadSession, formatAmount } from './session.js'
import { flags, setJsonMode, step, done, output, run } from './cli.js'

const USAGE = `balances.ts — private and public holdings per token

  --network <testnet|mainnet>   default testnet
  --token <symbol|id>           only this token
  --all                         include tokens with a zero balance
  --json                        machine-readable output`

const args = flags({ token: { type: 'string' }, all: { type: 'boolean' } }, USAGE)
setJsonMode(!!args.json)

await run(async () => {
  const { client, account, network } = await loadSession({ network: args.network as string | undefined })
  done(`session on ${network} for ${account.address}`)

  const only = args.token ? await client.resolveToken(args.token as string) : undefined
  step('scanning records and reading public balances')
  const balances = await client.getBalances(only ? { tokens: [only.id] } : {})

  const rows = Object.entries(balances)
    .map(([id, entry]) => ({ id, ...entry }))
    .filter((row) => args.all || row.total > 0n)
    .sort((a, b) => a.symbol.localeCompare(b.symbol))

  output({ network, address: account.address, tokens: rows }, (data) => {
    if (!data.tokens.length) {
      console.log('\nNo balances. Fund the account (testnet: `npx tsx setup.ts`) and try again.')
      return
    }
    console.log(`\n${data.address} on ${data.network}:\n`)
    for (const row of data.tokens) {
      console.log(
        `  ${row.symbol.padEnd(8)} ${formatAmount(row.private, row.decimals).padStart(28)} private  ` +
          `${formatAmount(row.public, row.decimals).padStart(20)} public`,
      )
      console.log(`    ${row.id}`)
    }
    // Worth stating rather than leaving to be discovered: a trade that "should"
    // work can fail on the private side alone.
    console.log('\nPrivate balances fund trades. Public ones do not — wrap or transfer first.')
  })
})
