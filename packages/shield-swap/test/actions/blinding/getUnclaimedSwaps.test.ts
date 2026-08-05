import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getUnclaimedSwaps } from '../../../src/actions/blinding/getUnclaimedSwaps.js'
import { toPersistedHandle } from '../../../src/utils/blinding/handles.js'
import { memoryBlindedIdentityStore, type BlindedIdentityRecord } from '../../../src/utils/blinding/store.js'
import type { SwapHandle } from '../../../src/actions/swap/swap.js'

const ADDR_A = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
const ADDR_B = 'aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t'
const USDC = '11field'
const ETH = '22field'

const handle = (blindedAddress: string, swapId: string): SwapHandle => ({
  swapId,
  blindingFactor: '1field',
  blindedAddress,
  tokenInId: USDC,
  tokenOutId: ETH,
  poolKey: '1field',
  amountIn: 1000n,
  transactionId: 'at1swap',
  program: 'shield_swap.aleo',
})

const record = (
  blindedAddress: string,
  counter: number,
  extra: Partial<BlindedIdentityRecord> = {},
): BlindedIdentityRecord => ({
  counter,
  blindingFactor: `${counter}field`,
  blindedAddress,
  status: 'swapped',
  ...extra,
})

/** An entry as `swap_outputs` holds it, keyed by swap id. */
const outputFor = (amountOut: string, amountRemaining = '0u128') =>
  `{\n  recipient: ${ADDR_A},\n  caller: ${ADDR_A},\n  token_in: ${USDC},\n` +
  `  token_out: ${ETH},\n  amount_out: ${amountOut},\n  amount_remaining: ${amountRemaining}\n}`

/** Client serving `swap_outputs` from a map, absent keys reading as claimed. */
function chainWith(outputs: Record<string, string>): { client: Client; reads: () => string[] } {
  const reads: string[] = []
  return {
    client: {
      request: async (req: { method: string; params?: { mapping?: string; key?: string } }) => {
        if (req.params?.mapping !== 'swap_outputs') return null
        const key = req.params.key ?? ''
        reads.push(key)
        return outputs[key] ?? null
      },
    } as unknown as Client,
    reads: () => reads,
  }
}

describe('getUnclaimedSwaps', () => {
  it('reports what is owed, with a handle ready to claim with', async () => {
    const store = memoryBlindedIdentityStore([
      record(ADDR_A, 0, { swapId: '7field', handle: toPersistedHandle(handle(ADDR_A, '7field')) }),
    ])
    const { client } = chainWith({ '7field': outputFor('5000u128') })

    const result = await getUnclaimedSwaps(client, { store })
    expect(result.swaps).toHaveLength(1)
    expect(result.swaps[0]!.output.amount_out).toBe(5000n)
    expect(result.claimable).toBe(1)
    // Rebuilt from the store, so a process that did not make the swap can claim
    // it — bigints back from their decimal strings.
    expect(result.swaps[0]!.handle!.amountIn).toBe(1000n)
    expect(result.totals).toEqual({ [ETH]: 5000n })
  })

  it('trusts the chain over the stored status', async () => {
    // Stored as `swapped`, but the entry is gone — claimed elsewhere, or by a
    // process whose store write never landed. Reporting it would promise money
    // that is not there.
    const store = memoryBlindedIdentityStore([record(ADDR_A, 0, { swapId: '7field' })])
    const { client } = chainWith({})
    const result = await getUnclaimedSwaps(client, { store })
    expect(result.swaps).toEqual([])
    expect(result.totals).toEqual({})
  })

  it('sums both sides across entries, because a claim pays both', async () => {
    const store = memoryBlindedIdentityStore([
      record(ADDR_A, 0, { swapId: '7field' }),
      record(ADDR_B, 1, { swapId: '8field' }),
    ])
    const { client } = chainWith({
      // The second swap was partially filled, so some input is refunded too.
      '7field': outputFor('5000u128'),
      '8field': outputFor('2500u128', '400u128'),
    })

    const result = await getUnclaimedSwaps(client, { store })
    expect(result.swaps).toHaveLength(2)
    expect(result.totals).toEqual({ [ETH]: 7500n, [USDC]: 400n })
    // Neither record carried a handle, so both are visible but not actionable.
    expect(result.claimable).toBe(0)
    expect(result.swaps.every((s) => s.claimable === false)).toBe(true)
  })

  it('separates consumed identities whose swap id was lost', async () => {
    const store = memoryBlindedIdentityStore([record(ADDR_A, 0)])
    const { client, reads } = chainWith({})
    const result = await getUnclaimedSwaps(client, { store })
    // Nothing on chain maps an identity to its swap, so there is no lookup to
    // make — say so rather than silently dropping it.
    expect(result.unresolvable).toHaveLength(1)
    expect(result.swaps).toEqual([])
    expect(reads()).toEqual([])
  })

  it('skips claimed records and unspent reservations without reading', async () => {
    const store = memoryBlindedIdentityStore([
      record(ADDR_A, 0, { status: 'claimed', swapId: '7field' }),
      record(ADDR_B, 1, { status: 'reserved' }),
    ])
    const { client, reads } = chainWith({ '7field': outputFor('5000u128') })

    const result = await getUnclaimedSwaps(client, { store })
    expect(result.swaps).toEqual([])
    // A reserved identity with no swap id is not lost, just unused — so it does
    // not belong in `unresolvable` either.
    expect(result.unresolvable).toEqual([])
    expect(reads()).toEqual([])
  })

  it('is empty for an empty store', async () => {
    const result = await getUnclaimedSwaps(chainWith({}).client, { store: memoryBlindedIdentityStore() })
    expect(result).toEqual({ swaps: [], totals: {}, claimable: 0, unresolvable: [] })
  })
})
