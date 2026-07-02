import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@veil/core'

// Mock ONLY the transaction-submission boundary; reads (getPool/getSlot/
// deadline) run their real implementations against the scripted client.
vi.mock('@veil/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@veil/core')>()
  return { ...actual, executeContract: vi.fn(), writeContract: vi.fn() }
})

import { executeContract, writeContract } from '@veil/core'
import { swapPrivate } from '../../../src/actions/swap/swapPrivate.js'
import { claimSwapOutputPrivate, SwapOutputNotFinalizedError } from '../../../src/actions/swap/claimSwapOutputPrivate.js'
import { MIN_SQRT_PRICE } from '../../../src/utils/tick-math.js'

const executeMock = vi.mocked(executeContract)
const writeMock = vi.mocked(writeContract)

// Real captured testnet plaintexts (ETHx/USDC pool).
const POOL_PLAINTEXT =
  '{\n  token0: 122352848155208110005843045field,\n  token1: 15594200448253854747971580789field,\n  fee: 10000u16,\n  enabled: true,\n  scale0: 1000000000u128,\n  scale1: 1u128\n}'
const SLOT_PLAINTEXT =
  '{\n  tick: -62200i32,\n  tick_spacing: 200u32,\n  sqrt_price: 411435173233802309u128,\n  fee_protocol: 0u8,\n  liquidity: 94217047056u128,\n  fee_growth_global0_x_64: 0u128,\n  fee_growth_global1_x_64: 0u128,\n  fee_residual0_x_64: 0u128,\n  fee_residual1_x_64: 0u128,\n  max_liquidity_per_tick: 9223372036854775808u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -64400i32,\n  next_init_above: -60000i32\n}'
const SWAP_OUTPUT_PLAINTEXT =
  '{\n  recipient: aleo1blinded000000000000000000000000000000000000000000000q3ljyzc,\n  caller: aleo1blinded000000000000000000000000000000000000000000000q3ljyzc,\n  token_in: 122352848155208110005843045field,\n  token_out: 15594200448253854747971580789field,\n  amount_out: 1980000u128,\n  amount_remaining: 0u128,\n  token_in_1: 0field,\n  amount_remaining_1: 0u128,\n  token_in_2: 0field,\n  amount_remaining_2: 0u128\n}'

const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'
const TOKEN0 = '122352848155208110005843045field'
const IDENTITY = { blindingFactor: '111field', blindedAddress: 'aleo1blinded000000000000000000000000000000000000000000000q3ljyzc' }
const RECORD = '{ owner: aleo1me.private, amount: 5000000000000000000u128.private, _nonce: 1group.public }'

/** Scripted client: chain reads answered per mapping; height fixed at 1000. */
function fakeClient(accountType: 'local' | 'rpc', overrides: Record<string, unknown> = {}): Client {
  return {
    account: {
      type: accountType,
      address: 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px',
      viewKey: 'AViewKey1unused',
    },
    request: async (req: { method: string; params?: { mapping?: string } }) => {
      if (req.method === 'getLatestHeight' || req.method === 'getBlockNumber') return 1000n
      if (req.method === 'getMappingValue') {
        const mapping = req.params?.mapping
        if (mapping && mapping in overrides) return overrides[mapping]
        if (mapping === 'pools') return POOL_PLAINTEXT
        if (mapping === 'slots') return SLOT_PLAINTEXT
        if (mapping === 'swap_outputs') return SWAP_OUTPUT_PLAINTEXT
        return null
      }
      throw new Error(`unexpected method ${req.method}`)
    },
  } as unknown as Client
}

beforeEach(() => {
  executeMock.mockReset()
  writeMock.mockReset()
})

describe('swapPrivate — local signer', () => {
  it('builds the exact positional literal inputs and returns a complete handle', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1tx', transitions: [], outputs: ['777field', 'record1...', 'record1...'] })

    const handle = await swapPrivate(fakeClient('local'), {
      poolKey: POOL_KEY,
      tokenInId: TOKEN0,
      amountIn: 10n ** 18n,
      slippageBps: 100,
      expectedOut: 2_000_000n,
      nonce: 42n,
      blindedIdentity: IDENTITY,
      tokenRecord: RECORD,
    })

    expect(executeMock).toHaveBeenCalledOnce()
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap_v0_0_2.aleo')
    expect(call.function).toBe('swap_private')
    // Exact positional order per the deployed ABI.
    expect(call.inputs).toEqual([
      RECORD,
      IDENTITY.blindingFactor,
      IDENTITY.blindedAddress,
      POOL_KEY,
      'true',                       // zero_for_one (selling token0)
      '1000000000000000000u128',    // amount_in
      '1980000u128',                // amount_out_min = 2_000_000 × (1 − 1%)
      `${MIN_SQRT_PRICE}u128`,      // directional extreme
      '42u64',                      // nonce
      '1100u32',                    // deadline = height 1000 + 100
      TOKEN0,                       // token0_id
      '15594200448253854747971580789field', // token1_id
    ])

    expect(handle.swapId).toBe('777field') // first public output
    expect(handle.blindingFactor).toBe(IDENTITY.blindingFactor)
    expect(handle.tokenOutId).toBe('15594200448253854747971580789field')
    expect(handle.transactionId).toBe('at1tx')
    expect(handle.program).toBe('shield_swap_v0_0_2.aleo')
  })

  it('rejects InputRequests on the local path', async () => {
    await expect(
      swapPrivate(fakeClient('local'), {
        poolKey: POOL_KEY,
        tokenInId: TOKEN0,
        amountIn: 10n ** 18n,
        blindedIdentity: IDENTITY,
        tokenRecord: { type: 'record', program: 'x.aleo', recordname: 'Token' },
      }),
    ).rejects.toThrow(/Local accounts cannot use InputRequests/)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('throws when the pool does not exist', async () => {
    await expect(
      swapPrivate(fakeClient('local', { pools: null }), {
        poolKey: POOL_KEY, tokenInId: TOKEN0, amountIn: 1n, blindedIdentity: IDENTITY, tokenRecord: RECORD,
      }),
    ).rejects.toThrow(/does not exist/)
  })
})

describe('swapPrivate — wallet signer', () => {
  it('fills blinding slots with issue-mode derived requests and requires tokenRecord', async () => {
    writeMock.mockResolvedValue('at1walletTx')
    const recordRequest = { type: 'record' as const, program: 'ethx.aleo', recordname: 'Token', filters: { amount: { gte: '1000000000000000000u128' } } }

    const handle = await swapPrivate(fakeClient('rpc'), {
      poolKey: POOL_KEY, tokenInId: TOKEN0, amountIn: 10n ** 18n, expectedOut: 2_000_000n, nonce: 42n,
      tokenRecord: recordRequest,
    })

    expect(writeMock).toHaveBeenCalledOnce()
    const inputs = writeMock.mock.calls[0]![1].inputs
    expect(inputs[0]).toEqual(recordRequest)
    expect(inputs[1]).toMatchObject({
      type: 'derived',
      algorithm: 'program-scoped-blinding-factor',
      args: {
        mode: { type: 'string', value: 'issue' },
        membershipProgram: { type: 'string', value: 'shield_swap_v0_0_2.aleo' },
        membershipMapping: { type: 'string', value: 'used_blinded_addresses' },
      },
    })
    expect(inputs[2]).toMatchObject({ type: 'derived', algorithm: 'program-scoped-blinded-address' })
    // Wallet fills the private slots — unknown until confirmation.
    expect(handle.swapId).toBeUndefined()
    expect(handle.blindedAddress).toBeUndefined()
    expect(handle.transactionId).toBe('at1walletTx')
  })

  it('demands tokenRecord with an actionable message', async () => {
    await expect(
      swapPrivate(fakeClient('rpc'), { poolKey: POOL_KEY, tokenInId: TOKEN0, amountIn: 10n ** 18n }),
    ).rejects.toThrow(/must provide tokenRecord/)
  })
})

describe('claimSwapOutputPrivate', () => {
  const handle = {
    swapId: '777field',
    ...IDENTITY,
    tokenInId: TOKEN0,
    tokenOutId: '15594200448253854747971580789field',
    poolKey: POOL_KEY,
    amountIn: 10n ** 18n,
    transactionId: 'at1tx',
    program: 'shield_swap_v0_0_2.aleo',
  }

  it('local: reads chain amounts and submits literal inputs', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1claim', transitions: [], outputs: [] })
    const res = await claimSwapOutputPrivate(fakeClient('local'), { handle })

    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('claim_swap_output_private')
    expect(call.inputs).toEqual([
      IDENTITY.blindingFactor,
      IDENTITY.blindedAddress,
      '777field',
      TOKEN0,                                  // token_in — from CHAIN, not handle
      '15594200448253854747971580789field',
      '1980000u128',                           // amount_out from chain
      '0u128',                                 // amount_remaining from chain
    ])
    expect(res.amountOut).toBe(1_980_000n)
    expect(res.transactionId).toBe('at1claim')
  })

  it('wallet: resolve-mode derived requests target the handle blindedAddress', async () => {
    writeMock.mockResolvedValue('at1walletClaim')
    await claimSwapOutputPrivate(fakeClient('rpc'), { handle })

    const inputs = writeMock.mock.calls[0]![1].inputs
    expect(inputs[0]).toMatchObject({
      type: 'derived',
      algorithm: 'program-scoped-blinding-factor',
      args: {
        mode: { type: 'string', value: 'resolve' },
        targetAddress: { type: 'address', value: IDENTITY.blindedAddress },
      },
    })
    expect(inputs[2]).toBe('777field')
  })

  it('throws SwapOutputNotFinalizedError when the output is absent', async () => {
    await expect(
      claimSwapOutputPrivate(fakeClient('local', { swap_outputs: null }), { handle }),
    ).rejects.toThrow(SwapOutputNotFinalizedError)
  })

  it('demands swapId (wallet-path resolution) before claiming', async () => {
    await expect(
      claimSwapOutputPrivate(fakeClient('local'), { handle: { ...handle, swapId: undefined } }),
    ).rejects.toThrow(/resolve it from the confirmed/)
  })
})
