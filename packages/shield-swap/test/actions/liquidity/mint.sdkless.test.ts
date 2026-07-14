import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@provablehq/veil-core'

vi.mock('@provablehq/veil-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@provablehq/veil-core')>()
  return { ...actual, executeContract: vi.fn(), writeContract: vi.fn() }
})

// The SDK-absent wallet bundle: tryLoadSdk resolves null, so the action must
// degrade to its pre-derivation shape (positionTokenId: undefined).
vi.mock('../../../src/utils/sdk.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/sdk.js')>()
  return { ...actual, tryLoadSdk: async () => null }
})

import { writeContract } from '@provablehq/veil-core'
import { mint } from '../../../src/actions/liquidity/mint.js'

const writeMock = vi.mocked(writeContract)

const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'
const TOKEN0 = '122352848155208110005843045field'
const TOKEN1 = '15594200448253854747971580789field'
const POOL_PLAINTEXT = `{\n  token0: ${TOKEN0},\n  token1: ${TOKEN1},\n  fee: 10000u16,\n  enabled: true,\n  scale0: 1000000000u128,\n  scale1: 1u128\n}`
const SLOT_PLAINTEXT =
  '{\n  tick: -62200i32,\n  tick_spacing: 200u32,\n  sqrt_price: 411435173233802309u128,\n  fee_protocol: 0u8,\n  liquidity: 94217047056u128,\n  fee_growth_global0_x_64: 0u128,\n  fee_growth_global1_x_64: 0u128,\n  fee_residual0_x_64: 0u128,\n  fee_residual1_x_64: 0u128,\n  max_liquidity_per_tick: 9223372036854775808u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -64400i32,\n  next_init_above: -60000i32\n}'

function walletClient(): Client {
  return {
    account: { type: 'rpc', address: 'aleo1me' },
    request: async (req: { method: string; params?: { mapping?: string } }) => {
      if (req.method === 'getMappingValue') {
        switch (req.params?.mapping) {
          case 'pools': return POOL_PLAINTEXT
          case 'slots': return SLOT_PLAINTEXT
          default: return null
        }
      }
      throw new Error(`unexpected method ${req.method}`)
    },
  } as unknown as Client
}

beforeEach(() => {
  writeMock.mockReset()
})

describe('mint — wallet path without the WASM peer', () => {
  it('returns positionTokenId: undefined, exactly the pre-derivation shape', async () => {
    writeMock.mockResolvedValue('at1walletmint')
    const res = await mint(walletClient(), {
      poolKey: POOL_KEY,
      tickLower: -64400,
      tickUpper: -60200,
      amount0Desired: 10n ** 18n,
      amount1Desired: 2_000_000n,
      token0Record: '{ granted0 }',
      token1Record: '{ granted1 }',
      tickLowerHint: -64400,
      tickUpperHint: -64400,
      nonce: '7field',
      recipient: 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h',
    })
    expect(res.transactionId).toBe('at1walletmint')
    expect(res.positionTokenId).toBeUndefined()
  })
})
