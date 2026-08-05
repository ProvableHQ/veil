import type { Client } from '@provablehq/veil-core'
import { getSwapOutput } from '../reads/getSwapOutput.js'
import { fromPersistedHandle } from '../../utils/blinding/handles.js'
import type { BlindedIdentityRecord, BlindedIdentityStore } from '../../utils/blinding/store.js'
import type { SwapOutput } from '../../generated/shield_swap.js'
import type { SwapHandle } from '../swap/swap.js'
import type { MultiHopSwapHandle } from '../swap/swapMultiHop.js'

/**
 * A swap whose output is still waiting in `swap_outputs`.
 *
 * @property blindedAddress The identity that owns the claim.
 * @property counter The identity's derivation counter, for tracing it back to
 *   the store.
 * @property swapId The `swap_outputs` key holding the proceeds.
 * @property output The on-chain entry: which tokens, how much out, how much of
 *   the input went unfilled and is refunded alongside it.
 * @property handle The handle rebuilt from the store, ready to pass to
 *   `claimSwapOutput`. Absent when the record predates handle storage or was
 *   written by a caller that only recorded a swap id.
 * @property claimable Whether this entry can be claimed from the store alone,
 *   which is exactly whether `handle` is present. A claim consumes a whole
 *   handle, so an entry without one is visible but not actionable here.
 */
export type UnclaimedSwap = {
  blindedAddress: string
  counter: number
  swapId: string
  output: SwapOutput
  handle?: SwapHandle | MultiHopSwapHandle
  claimable: boolean
}

/**
 * Parameters for {@link getUnclaimedSwaps}.
 *
 * @property store The store whose identities are checked.
 * @property program shield_swap program to read. Defaults to `DEFAULT_PROGRAM`
 *   inside the read.
 */
export type GetUnclaimedSwapsParameters = {
  store: BlindedIdentityStore
  program?: string
}

/**
 * Everything owed to this store's identities, and what cannot be determined.
 *
 * @property swaps One entry per unclaimed output, in store order.
 * @property totals Token id to raw base units owed across all entries — the
 *   output token gains `amount_out`, and the input token gains
 *   `amount_remaining`, since a claim pays both. Raw units, not decimals: the
 *   token registry holds the exponents.
 * @property claimable How many entries carry a handle and so can be claimed
 *   from the store alone.
 * @property unresolvable Identities the chain has consumed that carry no swap
 *   id, so their proceeds cannot be located. Nothing on chain maps an identity
 *   to its swap until a claim exists, so these need
 *   {@link reconcileSwapHistory} — and only after something claims them.
 */
export type GetUnclaimedSwapsReturnType = {
  swaps: UnclaimedSwap[]
  totals: Record<string, bigint>
  claimable: number
  unresolvable: BlindedIdentityRecord[]
}

/**
 * Summarizes the swaps this store's identities can still claim.
 *
 * Reads the chain rather than trusting the stored status, so the answer is
 * current whether or not {@link syncBlindedIdentities} has run recently: an
 * entry appears here when `swap_outputs` still holds its output, which is the
 * same condition that makes a claim succeed. A record the store calls `swapped`
 * whose output has since been claimed elsewhere is therefore omitted rather than
 * reported as money waiting.
 *
 * The point of `handle` and `claimable` is that a claim consumes a whole handle,
 * not a swap id — so this is what turns "something is owed" into a claim a
 * different process can actually make.
 *
 * Hits the network: one mapping read per identity that is not already `claimed`.
 * Does not write to the store, and does not claim anything.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Store and program override.
 * @returns The unclaimed entries, per-token totals, and the identities whose
 *   proceeds cannot be located.
 *
 * @example
 * const { swaps, totals, unresolvable } = await client.getUnclaimedSwaps()
 * for (const [tokenId, amount] of Object.entries(totals)) console.log(tokenId, amount)
 * for (const swap of swaps) {
 *   if (swap.claimable) await client.claimSwapOutput({ handle: swap.handle!, imports })
 * }
 * if (unresolvable.length) await client.reconcileSwapHistory()
 */
export async function getUnclaimedSwaps(
  client: Client,
  params: GetUnclaimedSwapsParameters,
): Promise<GetUnclaimedSwapsReturnType> {
  const records = await params.store.load()
  const swaps: UnclaimedSwap[] = []
  const totals: Record<string, bigint> = {}
  const unresolvable: BlindedIdentityRecord[] = []

  for (const record of records) {
    // `claimed` is terminal, and a `reserved` record whose swap never went out
    // has nothing to look up either — but one carrying a swap id might, so the
    // filter is the id rather than the status.
    if (record.status === 'claimed') continue
    if (!record.swapId) {
      if (record.status !== 'reserved') unresolvable.push(record)
      continue
    }

    const output = await getSwapOutput(client, {
      swapId: record.swapId,
      ...(params.program !== undefined ? { program: params.program } : {}),
    })
    // Absent means claimed already, or the request has not finalized yet.
    // Either way there is nothing to claim right now.
    if (!output) continue

    const handle = record.handle ? fromPersistedHandle(record.handle) : undefined
    swaps.push({
      blindedAddress: record.blindedAddress,
      counter: record.counter,
      swapId: record.swapId,
      output,
      ...(handle ? { handle } : {}),
      claimable: handle !== undefined,
    })

    // A claim pays the output token and refunds whatever of the input went
    // unfilled, so both sides count toward what is owed.
    totals[output.token_out] = (totals[output.token_out] ?? 0n) + output.amount_out
    if (output.amount_remaining > 0n) {
      totals[output.token_in] = (totals[output.token_in] ?? 0n) + output.amount_remaining
    }
  }

  return { swaps, totals, claimable: swaps.filter((swap) => swap.claimable).length, unresolvable }
}
