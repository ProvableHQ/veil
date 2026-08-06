/**
 * What the account is still owed from past swaps.
 *
 * A private swap does not pay out to the account directly. It pays to a
 * single-use blinded address, derived from the account's view key, which is what
 * keeps the trade from being linkable on chain. The proceeds sit there until
 * they are claimed, so a swap that submitted successfully but was never claimed
 * looks like nothing happened.
 *
 * This reads the chain rather than any local bookkeeping, which is the useful
 * property: an entry appears exactly when a claim would succeed, and disappears
 * when the money has landed.
 *
 * Reads only — claiming is in swap.ts.
 */
import { formatUnits } from '../../packages/shield-swap/src/index.js'
import { setupClient } from './setup-client.js'

export async function swapHistory() {
  const { client } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })

  // `claimable` counts what could be claimed right now, which is not the same as
  // the number of swaps listed: a claim consumes a whole blinded identity, and
  // an entry can be owed but not yet finalized.
  const { swaps, claimable } = await client.getUnclaimedSwaps()
  if (!swaps.length) {
    console.log('nothing outstanding')
    return
  }
  console.log(`${swaps.length} outstanding, ${claimable} claimable now`)

  const tokens = await client.listTokens()
  for (const { swapId, output, claimable } of swaps) {
    // `output` is the contract's own record of the trade, read from the
    // swap_outputs mapping — the amount is what a claim would pay, not an
    // estimate.
    const out = tokens.find((token) => token.id === output.token_out)
    console.log(
      `swap ${swapId}`,
      out ? `${formatUnits(output.amount_out, out.decimals)} ${out.symbol}` : `${output.amount_out} raw`,
      claimable ? 'claimable' : 'not yet finalized',
    )
  }

  // The blinded identities behind these are derived, not recorded on chain:
  // nothing lists an account's identities, and the account cannot enumerate its
  // own. The SDK keeps a store of the ones it has used, and that store is what
  // makes proceeds locatable.
  //
  // If it is ever lost, `client.reconcileSwapHistory()` rebuilds it by
  // re-deriving identities from the view key and matching them against chain
  // history. It is a recovery path, not a reason to treat the store as
  // disposable — a rebuild scans and takes time.
}
