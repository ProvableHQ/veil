import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { planSwap } from '../../../src/actions/swap/planSwap.js'
import type { ApiClient } from '../../../src/api/client.js'

const USDC = '11field'
const ETH = '22field'
const ALEO = '33field'
const POOL_A = '111field'
const POOL_B = '222field'

const TOKENS = [
  { address: USDC, symbol: 'USDCx', decimals: 6, amm_token_program: 'wrap_usdcx.aleo' },
  { address: ETH, symbol: 'ETH', decimals: 18, amm_token_program: 'wrap_eth.aleo' },
  { address: ALEO, symbol: 'ALEO', decimals: 6, amm_token_program: 'wrap_credits.aleo' },
]

const slot = (liquidity: string) =>
  `{\n  tick: 0i32,\n  tick_spacing: 60u32,\n  sqrt_price: { hi: 1u128, lo: 0u128 },\n  fee_protocol: 0u8,\n` +
  `  liquidity: ${liquidity},\n  fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 },\n` +
  `  fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 },\n  max_liquidity_per_tick: 1u128,\n` +
  `  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -60i32,\n  next_init_above: 60i32\n}`

/** Chain fake: slots by pool, control gates, and program sources for imports. */
function chain(options: { liquidity?: Record<string, string>; paused?: string[] } = {}): Client {
  return {
    request: async (req: { method: string; params?: { mapping?: string; key?: string; programId?: string } }) => {
      if (req.method === 'getProgram') return 'program x.aleo;\n'
      const { mapping, key } = req.params ?? {}
      if (mapping === 'slots') return slot(options.liquidity?.[key ?? ''] ?? '1000u128')
      // Absent from every control mapping reads as "not paused".
      if (mapping === 'paused_pairs' || mapping === 'paused_tokens') return null
      if (mapping === 'pools') return `{\n  token0: ${USDC},\n  token1: ${ETH},\n  fee: 3000u16,\n  enabled: ${!options.paused?.includes(key ?? '')}\n}`
      return null
    },
  } as unknown as Client
}

/**
 * API fake serving the registry and a scripted route.
 *
 * Records the `amount_in` it was sent, because the endpoint takes decimals while
 * the rest of the SDK takes base units — sending the wrong one quotes a trade
 * orders of magnitude off and builds an unmeetable slippage floor.
 */
function api(
  hops: Array<{ pool_key: string; token_in: string; token_out: string }>,
  quote?: string,
): { api: ApiClient; sentAmountIn: () => string | undefined } {
  let sent: string | undefined
  return {
    api: {
      getTokens: async () => ({ data: TOKENS }),
      getRoute: async (query: { amount_in?: string }) => {
        sent = query.amount_in
        return {
          data: {
            hops,
            ...(quote === undefined ? {} : { estimated_amount_out: quote }),
            token_in: USDC,
            token_out: ETH,
          },
        }
      },
    } as unknown as ApiClient,
    sentAmountIn: () => sent,
  }
}

describe('planSwap', () => {
  it('quotes in decimals and returns base units', async () => {
    // The numbers are the real ones: 0.5 USDCx quoted 0.000268655644950769 ETH
    // on testnet. Sending base units instead quoted the pool's whole depth.
    const scripted = api([{ pool_key: POOL_A, token_in: USDC, token_out: ETH }], '0.000268655644950769')
    const plan = await planSwap(chain(), scripted.api, {
      from: 'USDCx',
      to: 'ETH',
      amountIn: 500_000n, // 0.5 USDCx at 6 decimals
    })

    // The regression that cost a reverted transaction: the endpoint wants
    // decimals in the input token's units, not the base units every action takes.
    expect(scripted.sentAmountIn()).toBe('0.5')
    expect(plan.multiHop).toBe(false)
    expect(plan.poolKeys).toEqual([POOL_A])
    // Back in base units at the OUT token's 18 decimals, not the input's 6.
    expect(plan.expectedOut).toBe(268_655_644_950_769n)
    // 50 bps default: the floor the contract enforces, not the quote itself.
    expect(plan.minOut).toBe(267_312_366_726_015n)
    expect(plan.from.symbol).toBe('USDCx')
    expect(plan.imports).toHaveProperty('wrap_usdcx.aleo')
    expect(plan.imports).toHaveProperty('wrap_eth.aleo')
  })

  it('marks a two-hop route and carries every hop’s imports', async () => {
    const plan = await planSwap(
      chain(),
      api([
        { pool_key: POOL_A, token_in: USDC, token_out: ALEO },
        { pool_key: POOL_B, token_in: ALEO, token_out: ETH },
      ]).api,
      { from: 'USDCx', to: 'ETH', amountIn: 1n },
    )
    expect(plan.multiHop).toBe(true)
    expect(plan.poolKeys).toEqual([POOL_A, POOL_B])
    // The bridging token's program is the one callers forget on multi-hop, and
    // omitting it fails at proving with an unrelated-looking message.
    expect(plan.imports).toHaveProperty('wrap_credits.aleo')
  })

  it('carries no floor when the API returns no quote', async () => {
    const plan = await planSwap(chain(), api([{ pool_key: POOL_A, token_in: USDC, token_out: ETH }]).api, {
      from: 'USDCx',
      to: 'ETH',
      amountIn: 1n,
    })
    // A zero floor accepts any fill. Reporting it as zero is honest; inventing
    // one from a quote that does not exist would not be.
    expect(plan.expectedOut).toBe(0n)
    expect(plan.minOut).toBe(0n)
  })

  it('honours a tighter slippage setting', async () => {
    const plan = await planSwap(chain(), api([{ pool_key: POOL_A, token_in: USDC, token_out: ETH }], '10000').api, {
      from: 'USDCx',
      to: 'ETH',
      amountIn: 1n,
      slippageBps: 10,
    })
    expect(plan.expectedOut).toBe(10_000n * 10n ** 18n)
    expect(plan.minOut).toBe(9_990n * 10n ** 18n)
  })

  it('refuses a route whose hop has no liquidity, naming the pool', async () => {
    await expect(
      planSwap(chain({ liquidity: { [POOL_B]: '0u128' } }), api([
        { pool_key: POOL_A, token_in: USDC, token_out: ALEO },
        { pool_key: POOL_B, token_in: ALEO, token_out: ETH },
      ]).api, { from: 'USDCx', to: 'ETH', amountIn: 1n }),
    ).rejects.toThrow(new RegExp(`${POOL_B}.*no liquidity`, 's'))
  })

  it('refuses a swap with no route rather than returning an empty plan', async () => {
    await expect(
      planSwap(chain(), api([]).api, { from: 'USDCx', to: 'ETH', amountIn: 1n }),
    ).rejects.toThrow(/no route from USDCx to ETH/)
  })

  it('refuses to swap a token for itself', async () => {
    await expect(
      planSwap(chain(), api([]).api, { from: 'USDCx', to: 'usdcx', amountIn: 1n }),
    ).rejects.toThrow(/cannot swap USDCx for itself/)
  })
})
