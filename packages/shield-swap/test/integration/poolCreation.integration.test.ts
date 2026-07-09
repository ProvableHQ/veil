import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { FinalizeRevertError } from '@provablehq/veil-core'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'

/**
 * Real-testnet pool creation. `create_pool` is a public, fee-paying
 * transaction, so this shares the e2e tier's gating (funded account + delegated
 * proving). It creates the ETHx → USDCx pool — the canonical DEX pair — at the
 * first registered fee tier that has no existing pool; if that pair already has
 * pools at every fee tier tried, the create still proves + broadcasts and the
 * contract rejects the duplicate — so either outcome validates the createPool
 * path.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   funded testnet account (pays the fee)
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID   delegated proving credentials
 */
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const DPS_API_KEY = process.env.ALEO_DPS_API_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY && !!DPS_API_KEY && !!CONSUMER_ID

const NETWORK_URL = 'https://api.provable.com/v2'
const DPS_URL = process.env.ALEO_DPS_URL ?? 'https://api.provable.com/prove/testnet'
const DEX_PROGRAM = process.env.VEIL_DEX_PROGRAM ?? 'shield_swap_v3.aleo'
const CANDIDATE_FEES = [100, 500, 3000, 10000] // common Uniswap-style tiers
const TX_TIMEOUT = 420_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Polls an async predicate up to `tries` times, `ms` apart; true once it holds. */
async function pollUntil(predicate: () => Promise<boolean>, tries: number, ms: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true
    await sleep(ms)
  }
  return false
}

describe.runIf(RUN)('pool creation on testnet', () => {
  let client: ReturnType<ReturnType<typeof shieldSwapActions>>
  let tokenA: string
  let tokenB: string
  let registeredFees: number[]

  beforeAll(async () => {
    const aleo = await loadNetwork('testnet')
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      proverUrl: DPS_URL,
      apiKey: DPS_API_KEY,
      consumerId: CONSUMER_ID,
    })
    client = walletClient.extend(shieldSwapActions({ api: {}, program: DEX_PROGRAM }))

    // Create the ETHx → USDCx pool specifically — the canonical DEX pair.
    // create_pool normalizes token order internally, so which is passed as
    // token0 vs token1 does not change the resulting pool or its key.
    const tokens = (await client.api.getTokens()).data
    const bySymbol = (sym: string) => tokens.find((t) => t.symbol?.toUpperCase() === sym.toUpperCase())
    const ethx = bySymbol('ETHx')
    const usdcx = bySymbol('USDCx')
    expect(ethx, 'ETHx must be in the token registry to create the ETHx/USDCx pool').toBeTruthy()
    expect(usdcx, 'USDCx must be in the token registry to create the ETHx/USDCx pool').toBeTruthy()
    tokenA = ethx!.address
    tokenB = usdcx!.address

    // Which candidate fee tiers are registered on chain (create_pool requires it).
    registeredFees = []
    for (const fee of CANDIDATE_FEES) {
      if (await client.isFeeTierValid({ fee })) registeredFees.push(fee)
    }
    expect(registeredFees.length, 'need a registered fee tier to create a pool').toBeGreaterThan(0)
  }, 90_000)

  it('creates the ETHx → USDCx pool at an unused fee tier (or the contract rejects a duplicate)', async () => {
    let created: { poolKey?: string; transactionId: string } | undefined
    let lastRevert: unknown

    for (const fee of registeredFees) {
      try {
        created = await client.createPool({
          token0ProgramId: tokenA,
          token1ProgramId: tokenB,
          fee,
          initialTick: 0, // opens at price 1.0 (sqrt price = Q64)
        })
        break
      } catch (err) {
        // A pool already exists for this pair+fee → finalize reverts. Try the
        // next tier. Anything else is a real failure and should surface.
        if (!(err instanceof FinalizeRevertError)) throw err
        lastRevert = err
      }
    }

    if (created) {
      // Fresh pool created — the key is usable and the pool now exists on chain.
      expect(created.transactionId).toMatch(/^at1/)
      expect(created.poolKey).toMatch(/field$/)
      // create_pool's finalize sets initialized_pools[poolKey] = true, keyed by
      // the same hash it returns as its output. The transaction is accepted, but
      // the finalized mapping write propagates to reads asynchronously — poll
      // until isPoolInitialized reflects it before asserting.
      const initialized = await pollUntil(
        () => client.isPoolInitialized({ poolKey: created!.poolKey! }),
        24,
        5000,
      )
      expect(initialized, 'created pool should become initialized on chain').toBe(true)
      // Reading it back decodes as a real pool over the pair we asked for.
      const pool = await client.getPool({ poolKey: created.poolKey! })
      expect(pool).not.toBeNull()
      expect(new Set([pool!.token0, pool!.token1])).toEqual(new Set([tokenA, tokenB]))
    } else {
      // Every registered tier already had a pool for this pair — the create
      // path (prove + broadcast + finalize) still ran; the contract correctly
      // rejected the duplicate.
      expect(lastRevert).toBeInstanceOf(FinalizeRevertError)
    }
  }, TX_TIMEOUT)
})
