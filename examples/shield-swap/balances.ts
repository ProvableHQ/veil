/**
 * What the account holds, private and public.
 *
 * Aleo tokens exist in two forms, and only one of them can trade. A private
 * balance is a set of records the account owns; a public balance is an entry in
 * a mapping. Swaps and liquidity deposits spend records, so the private side is
 * what funds everything here.
 *
 * A freshly funded account therefore reads as zero public balance — the faucet
 * delivers records, not mapping entries. That is normal, not a failed airdrop.
 *
 * Reading the private side needs the record scanner, since records are only
 * visible to whoever can decrypt them.
 */
import { formatUnits } from '../../packages/shield-swap/src/index.js'
import { setupClient } from './setup-client.js'

export async function balances() {
  const { client, account } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })

  // Called without arguments, this returns only tokens the account actually
  // holds. Pass `{ tokens: [...] }` to ask about specific ones, including any
  // the account holds nothing of — filtering afterwards would drop those rows
  // instead of showing them as zero.
  const held = await client.getBalances()

  console.log(account.address)
  for (const [id, balance] of Object.entries(held)) {
    console.log(
      balance.symbol.padEnd(6),
      `private ${formatUnits(balance.private, balance.decimals)}`,
      `public ${formatUnits(balance.public, balance.decimals)}`,
      id,
    )
  }

  // One consequence worth carrying into any trade sizing: record selection picks
  // a single record large enough to cover the amount. It does not add several
  // together. An account showing 10 spread across five records of 2 cannot fund
  // a trade of 10, and the failure looks like an unexplained shortfall rather
  // than a balance problem.
}
