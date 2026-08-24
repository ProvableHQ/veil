import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getSwapExecution } from '../../../src/actions/reads/getSwapExecution.js'

const SWAP_ID = '777field'
const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'

const HEADER = '{\n  executed_height: 5000u32,\n  hop_count: 2u8\n}'
const hop = (amountIn: bigint, feePaid: bigint, protocolFee: bigint) =>
  `{\n  pool: ${POOL_KEY},\n  zero_for_one: true,\n  amount_in: ${amountIn}u128,\n  amount_out: 990000u128,\n  fee_paid: ${feePaid}u128,\n  protocol_fee: ${protocolFee}u128,\n  sqrt_price_after: { hi: 1u128, lo: 0u128 },\n  liquidity_after: 94217047056u128,\n  tick_after: -60i32\n}`

// Scripted client: header plus two hops keyed by the composite struct literal.
const fakeClient = (values: Record<string, string | null>): Client =>
  ({
    request: async (req: { method: string; params?: { mapping?: string; key?: string } }) => {
      if (req.method !== 'getMappingValue') throw new Error(`unexpected ${req.method}`)
      const { mapping, key } = req.params!
      if (mapping === 'swap_execution_headers') return values.header ?? null
      if (mapping === 'swap_execution_hops') return values[key!] ?? null
      throw new Error(`unexpected mapping ${mapping}`)
    },
  }) as unknown as Client

describe('getSwapExecution', () => {
  it('reads the header then each hop by composite key, computing the LP fee', async () => {
    const client = fakeClient({
      header: HEADER,
      [`{ swap_id: ${SWAP_ID}, hop_index: 0u8 }`]: hop(1000000n, 3000n, 937n),
      [`{ swap_id: ${SWAP_ID}, hop_index: 1u8 }`]: hop(990000n, 2970n, 928n),
    })
    const execution = await getSwapExecution(client, { swapId: SWAP_ID })
    expect(execution).not.toBeNull()
    expect(execution!.header.executed_height).toBe(5000)
    expect(execution!.hops).toHaveLength(2)
    expect(execution!.hops[0]!.lp_fee).toBe(3000n - 937n)
    expect(execution!.hops[1]!.amount_in).toBe(990000n)
  })

  it('returns null for a pre-upgrade or unfinalized swap', async () => {
    expect(await getSwapExecution(fakeClient({}), { swapId: SWAP_ID })).toBeNull()
  })

  it('throws when a hop named by the header is absent', async () => {
    const client = fakeClient({ header: HEADER, [`{ swap_id: ${SWAP_ID}, hop_index: 0u8 }`]: hop(1n, 1n, 0n) })
    await expect(getSwapExecution(client, { swapId: SWAP_ID })).rejects.toThrow(/hop 1/)
  })
})
