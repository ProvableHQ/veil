import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@veil/provable-sdk'
import { FinalizeRevertError } from '@veil/core'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'

/**
 * Real-testnet pool creation. `create_pool` is a public, fee-paying
 * transaction, so this shares the e2e tier's gating (funded account + delegated
 * proving). It finds a token pair + registered fee tier with no existing pool
 * and creates one; if the pair already has pools at every fee tier tried, the
 * create still proves + broadcasts and the contract rejects the duplicate — so
 * either outcome validates the createPool path.
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
const DEX_PROGRAM = process.env.VEIL_DEX_PROGRAM ?? 'shield_swap_v0_0_2.aleo'
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

    // A token pair to create a pool for. Take two from the far end of the
    // registry — less-popular tokens are likelier to have an unused fee tier.
    const tokens = (await client.api.getTokens()).data
    expect(tokens.length).toBeGreaterThanOrEqual(2)
    tokenA = tokens[tokens.length - 1]!.address
    tokenB = tokens[tokens.length - 2]!.address

    // Which candidate fee tiers are registered on chain (create_pool requires it).
    registeredFees = []
    for (const fee of CANDIDATE_FEES) {
      if (await client.isFeeTierValid({ fee })) registeredFees.push(fee)
    }
    expect(registeredFees.length, 'need a registered fee tier to create a pool').toBeGreaterThan(0)
  }, 90_000)

  it('creates a pool at an unused fee tier (or the contract rejects a duplicate)', async () => {
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
