import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { reconcileSwapHistory } from '../../../src/actions/blinding/reconcileSwapHistory.js'
import { memoryBlindedIdentityStore, type BlindedIdentityRecord } from '../../../src/utils/blinding/store.js'

const PROGRAM = 'shield_swap.aleo'
const ADDR_A = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
const ADDR_B = 'aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t'

const reserved = (blindedAddress: string, counter: number): BlindedIdentityRecord => ({
  counter,
  blindingFactor: `${counter}field`,
  blindedAddress,
  status: 'reserved',
})

/**
 * A claim transition shaped like the real one: the blinding factor is private
 * (a ciphertext on chain), everything else public. Positions match the program's
 * signature, which is what the action reads by index.
 */
const claimTx = (blindedAddress: string, swapId: string, amountOut: string) => ({
  id: 'at1claim',
  type: 'execute',
  execution: {
    transitions: [
      // A co-transition from the router, to prove the action picks the core one.
      { id: 'au1other', program: 'shield_swap_router.aleo', function: 'claim_to_wrapped', inputs: [] },
      {
        id: 'au1claim',
        program: PROGRAM,
        function: 'claim_swap_output',
        inputs: [
          { type: 'private', id: 'i0', value: 'ciphertext1qgq...' },
          { type: 'public', id: 'i1', value: blindedAddress },
          { type: 'public', id: 'i2', value: swapId },
          { type: 'public', id: 'i3', value: '11field' },
          { type: 'public', id: 'i4', value: '22field' },
          { type: 'public', id: 'i5', value: amountOut },
          { type: 'public', id: 'i6', value: '0u128' },
        ],
      },
    ],
  },
})

/**
 * Client answering the two public endpoints the action uses.
 *
 * @param pages Pages of call history, served in order.
 * @param txs Transaction id → transaction body.
 */
function historyClient(
  pages: Array<{ calls: Array<Record<string, unknown>>; next_cursor: unknown }>,
  txs: Record<string, unknown>,
): { client: Client; requests: () => string[] } {
  const requests: string[] = []
  let page = 0
  return {
    client: {
      request: async (req: { method: string; params?: { id?: string } }) => {
        requests.push(req.method)
        if (req.method === 'getProgramCallsPaginated') return pages[Math.min(page++, pages.length - 1)]
        if (req.method === 'getTransaction') return txs[req.params?.id ?? '']
        throw new Error(`unexpected ${req.method}`)
      },
    } as unknown as Client,
    requests: () => requests,
  }
}

const call = (id: string, fn = 'claim_swap_output', status = 'Accepted') => ({
  transaction_id: id,
  function_id: fn,
  block_number: 100,
  block_timestamp: '1785874399',
  status,
})

describe('reconcileSwapHistory', () => {
  it('recovers the swap id and marks the identity claimed', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDR_A, 0)])
    const { client } = historyClient(
      [{ calls: [call('at1claim')], next_cursor: null }],
      // The history reports field values bare; the action normalises them,
      // because the mapping key they become is a field literal.
      { at1claim: claimTx(ADDR_A, '6027043763583019120471660372455836698', '175488u128') },
    )

    const result = await reconcileSwapHistory(client, { store, program: PROGRAM })
    expect(result.claims).toHaveLength(1)
    expect(result.claims[0]!.swapId).toBe('6027043763583019120471660372455836698field')
    expect(result.claims[0]!.amountOut).toBe(175488n)
    expect(result.claims[0]!.tokenOut).toBe('22field')
    expect(result.complete).toBe(true)

    const [record] = await store.load()
    expect(record!.status).toBe('claimed')
    expect(record!.swapId).toBe('6027043763583019120471660372455836698field')
  })

  it('ignores claims belonging to other accounts', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDR_A, 0)])
    const { client } = historyClient(
      [{ calls: [call('at1other')], next_cursor: null }],
      { at1other: claimTx(ADDR_B, '99', '5u128') },
    )

    const result = await reconcileSwapHistory(client, { store, program: PROGRAM })
    expect(result.claims).toEqual([])
    expect((await store.load())[0]!.status).toBe('reserved')
  })

  it('skips rejected claims, which consumed nothing', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDR_A, 0)])
    const { client, requests } = historyClient(
      [{ calls: [call('at1rejected', 'claim_swap_output', 'Rejected')], next_cursor: null }],
      { at1rejected: claimTx(ADDR_A, '1', '5u128') },
    )

    const result = await reconcileSwapHistory(client, { store, program: PROGRAM })
    expect(result.claims).toEqual([])
    // Not even fetched: the call listing already said it failed.
    expect(requests().filter((m) => m === 'getTransaction')).toEqual([])
  })

  it('stops paging once every identity is resolved', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDR_A, 0)])
    const { client, requests } = historyClient(
      [
        { calls: [call('at1claim')], next_cursor: { block_number: 90, transition_id: 'au1x' } },
        { calls: [call('at1more')], next_cursor: { block_number: 80, transition_id: 'au1y' } },
      ],
      { at1claim: claimTx(ADDR_A, '7', '5u128'), at1more: claimTx(ADDR_B, '8', '5u128') },
    )

    const result = await reconcileSwapHistory(client, { store, program: PROGRAM })
    // One page, despite a cursor inviting another: nothing is left to look for.
    expect(result.pagesScanned).toBe(1)
    expect(result.complete).toBe(true)
    expect(requests().filter((m) => m === 'getProgramCallsPaginated')).toHaveLength(1)
  })

  it('reports an incomplete walk when it runs out of pages', async () => {
    const store = memoryBlindedIdentityStore([reserved(ADDR_A, 0)])
    const { client } = historyClient(
      [{ calls: [call('at1nomatch', 'swap')], next_cursor: { block_number: 90, transition_id: 'au1x' } }],
      {},
    )

    const result = await reconcileSwapHistory(client, { store, program: PROGRAM, maxPages: 2 })
    // History continues but the budget ran out, so older claims may exist —
    // saying so is what lets a caller raise maxPages instead of trusting it.
    expect(result.complete).toBe(false)
    expect(result.pagesScanned).toBe(2)
    expect(result.claims).toEqual([])
  })

  it('costs nothing when every identity is already claimed', async () => {
    const store = memoryBlindedIdentityStore([{ ...reserved(ADDR_A, 0), status: 'claimed' }])
    const { client, requests } = historyClient([{ calls: [], next_cursor: null }], {})

    const result = await reconcileSwapHistory(client, { store, program: PROGRAM })
    expect(result).toMatchObject({ claims: [], pagesScanned: 0, complete: true })
    expect(requests()).toEqual([])
  })

  it('does not write to the store when nothing changed', async () => {
    let saves = 0
    const inner = memoryBlindedIdentityStore([reserved(ADDR_A, 0)])
    const store = {
      load: inner.load,
      save: async (records: BlindedIdentityRecord[]) => {
        saves++
        return inner.save(records)
      },
    }
    const { client } = historyClient([{ calls: [], next_cursor: null }], {})

    await reconcileSwapHistory(client, { store, program: PROGRAM })
    expect(saves).toBe(0)
  })
})
