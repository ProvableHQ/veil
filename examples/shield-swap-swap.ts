/**
 * Shield Swap: a confidential swap end to end (quote → swap → claim).
 *
 * The whole point of this file is to show the flat, viem-shaped surface: you
 * build a client, `.extend()` it with the DEX actions, and call typed methods
 * off it (`client.api.getRoute`, `client.swap`, `client.claimSwapOutput`). If
 * you have used viem on Ethereum, the shape is the same — a client, actions,
 * and typed calls — applied to Aleo. There are almost no helpers here on
 * purpose; every step is a bare call so the API reads for itself.
 *
 * A private swap is two transactions: `swap` submits the request and, once it
 * finalizes, the chain stores the computed output; `claimSwapOutput` then
 * collects it as private records. The SDK derives the blinded identity and
 * sequences both — see the CLI Integration Guide for the on-chain mechanics.
 *
 * Runs against the live testnet, so it is gated like the fund-moving tier.
 * Needs a funded account that already holds the input token, plus delegated
 * proving + scanner credentials. Run with:
 *
 *   VEIL_INTEGRATION=1 \
 *   VEIL_E2E_PRIVATE_KEY=APrivateKey1... \
 *   ALEO_DPS_API_KEY=... ALEO_CONSUMER_ID=... \
 *   npx vitest run examples/shield-swap-swap.ts
 *
 * Self-skips if the DEX has no pools to trade against yet.
 */

import { describe, it, expect } from 'vitest'
import { getProgram } from '../packages/core/src/index.js'
import { loadNetwork } from '../packages/provable-sdk/src/index.js'
import { shieldSwapActions, SwapOutputNotFinalizedError } from '../packages/shield-swap/src/index.js'

const RUN =
  process.env.VEIL_INTEGRATION === '1' &&
  !!process.env.VEIL_E2E_PRIVATE_KEY &&
  !!process.env.ALEO_DPS_API_KEY &&
  !!process.env.ALEO_CONSUMER_ID

const AMM_API_URL = process.env.AMM_API_URL ?? 'https://amm-api.dev.provable.com'

describe.runIf(RUN)('example: swap on Shield Swap', () => {
  it('quotes, swaps, and claims the output', async (ctx) => {
    // ---- Build the client: local key, delegated proving, a record scanner so
    // it can find the private token records the swap spends. Then extend it
    // with the DEX actions — everything hangs off `client` after this.
    const aleo = await loadNetwork('testnet')
    const scanner = aleo.createRemoteScanner({
      url: 'https://api.provable.com/scanner',
      consumerId: process.env.ALEO_CONSUMER_ID!,
      apiKey: process.env.ALEO_DPS_API_KEY!,
    })
    const { walletClient } = aleo.createAleoClient({
      privateKey: process.env.VEIL_E2E_PRIVATE_KEY!,
      networkUrl: 'https://api.provable.com/v2',
      provingMode: 'delegated',
      proverUrl: 'https://api.provable.com/prove/testnet',
      apiKey: process.env.ALEO_DPS_API_KEY,
      consumerId: process.env.ALEO_CONSUMER_ID,
      records: scanner,
    })
    const client = walletClient.extend(shieldSwapActions({ api: { baseUrl: AMM_API_URL } }))

    // ---- Authenticate with the DEX API. Most endpoints (routes, balances,
    // fee tiers) are bearer-gated; the account signs a challenge once and the
    // session renews itself on expiry. A long-lived key works too:
    // shieldSwapActions({ api: { apiToken: process.env.SHIELD_SWAP_API_TOKEN } }).
    await client.authenticateApi()

    // ---- Pick a pool. Discovery goes through the off-chain API, namespaced
    // under `client.api` so a call site shows chain vs service at a glance.
    const { data: pools } = await client.api.getPools()
    if (pools.length === 0) return ctx.skip() // nothing to trade against yet

    const pool = pools[0]!
    const t0 = pool.token0_info
    const t1 = pool.token1_info
    if (!t0?.wrapper_program || !t1?.wrapper_program) return ctx.skip() // metadata not indexed yet

    const tokenIn = pool.token0
    const tokenOut = pool.token1
    const tokenInProgram = t0.wrapper_program
    const amountIn = 1_000_000n

    // ---- Preload the token program sources the swap dispatches into. Fetched
    // once with getProgram; the SDK resolves the rest of the import closure.
    const imports = {
      [t0.wrapper_program]: await getProgram(walletClient, { programId: t0.wrapper_program }),
      [t1.wrapper_program]: await getProgram(walletClient, { programId: t1.wrapper_program }),
    }

    // ---- Quote (informational). client.api.getRoute finds a path and, given
    // amount_in, an estimated output — good for routing and UX. For a slippage
    // floor on a real trade, derive `expectedOut` from an authoritative quote
    // (see the CLI Integration Guide) and pass it to swap. This tiny demo omits
    // it, so the SDK applies a spot-price floor from slippageBps instead.
    const route = await client.api.getRoute({ token_in: tokenIn, token_out: tokenOut, amount_in: amountIn })
    console.log(`route estimate: ${route.data.estimated_amount_out ?? 'unavailable'}`)

    // ---- Phase 1: submit the swap. The local key auto-selects an input record
    // covering amountIn and derives the single-use claim identity; the returned
    // handle is the key to claiming, complete with swapId + blindedAddress.
    const handle = await client.swap({
      poolKey: pool.key,
      tokenInId: tokenIn,
      amountIn,
      slippageBps: 100, // 1% floor off the spot estimate (no explicit quote here)
      tokenInProgram,
      imports,
    })
    expect(handle.swapId).toBeTruthy()

    // ---- Phase 2: claim. The request must finalize first (the indexer runs a
    // few seconds behind), so retry on SwapOutputNotFinalizedError.
    let claimed: { amountOut: bigint; amountRemaining: bigint } | undefined
    for (let i = 0; i < 20; i++) {
      try {
        claimed = await client.claimSwapOutput({ handle, imports })
        break
      } catch (err) {
        if (!(err instanceof SwapOutputNotFinalizedError)) throw err
        await new Promise((resolve) => setTimeout(resolve, 3_000))
      }
    }

    expect(claimed).toBeTruthy()
    expect(claimed!.amountOut).toBeGreaterThan(0n)
    console.log(`swapped ${amountIn} → received ${claimed!.amountOut}, refunded ${claimed!.amountRemaining}`)
  }, 300_000)
})
