/**
 * Shield Swap: the full liquidity lifecycle — create pool, mint a position,
 * add to it, remove from it, collect what is owed, and burn it.
 *
 * Like the swap example, this shows the flat, viem-shaped surface: one client,
 * `.extend()`-ed with the DEX actions, then bare typed calls — `client.createPool`,
 * `client.mint`, `client.increaseLiquidity`, `client.decreaseLiquidity`,
 * `client.collect`, `client.burn`. It also uses `derivePoolKey` to address the
 * pool locally (no round trip) and skip creation when it already exists.
 *
 * Positions are private records. With a local key the SDK auto-selects the
 * funding token records and the position NFT by pool key, so the calls stay
 * short; a wallet account would pass them as `record` InputRequests instead.
 *
 * Runs against the live testnet and moves real balances, so it is gated. Needs
 * a funded account that already holds BOTH pool tokens as private records,
 * plus delegated proving + scanner credentials. Run with:
 *
 *   VEIL_INTEGRATION=1 \
 *   VEIL_E2E_PRIVATE_KEY=APrivateKey1... \
 *   ALEO_DPS_API_KEY=... ALEO_CONSUMER_ID=... \
 *   npx vitest run examples/shield-swap-liquidity.ts
 *
 * Self-skips if the DEX has no pool to source token ids from, or if the account
 * does not hold both tokens.
 */

import { describe, it, expect } from 'vitest'
import { getProgram } from '../packages/core/src/index.js'
import { loadNetwork } from '../packages/provable-sdk/src/index.js'
import { shieldSwapActions, derivePoolKey, DEFAULT_PROGRAM } from '../packages/shield-swap/src/index.js'

const RUN =
  process.env.VEIL_INTEGRATION === '1' &&
  !!process.env.VEIL_E2E_PRIVATE_KEY &&
  !!process.env.ALEO_DPS_API_KEY &&
  !!process.env.ALEO_CONSUMER_ID

const AMM_API_URL = process.env.AMM_API_URL ?? 'https://amm-api.dev.provable.com'

describe.runIf(RUN)('example: provide liquidity on Shield Swap', () => {
  it('creates a pool, mints, resizes, collects, and burns a position', async (ctx) => {
    // ---- Build and extend the client (local key + delegated proving + scanner).
    const aleo = await loadNetwork('testnet')
    const scanner = aleo.createRemoteScanner({
      url: 'https://api.provable.com/scanner',
      consumerId: process.env.ALEO_CONSUMER_ID!,
      apiKey: process.env.ALEO_DPS_API_KEY!,
    })
    const { walletClient, publicClient } = aleo.createAleoClient({
      privateKey: process.env.VEIL_E2E_PRIVATE_KEY!,
      networkUrl: 'https://api.provable.com/v2',
      provingMode: 'delegated',
      proverUrl: 'https://api.provable.com/prove/testnet',
      apiKey: process.env.ALEO_DPS_API_KEY,
      consumerId: process.env.ALEO_CONSUMER_ID,
      records: scanner,
    })
    const client = walletClient.extend(shieldSwapActions({ api: { baseUrl: AMM_API_URL } }))

    // ---- Source a real token pair from an existing pool (their ids are allowed
    // on chain), then work a DIFFERENT fee tier so we get our own fresh pool.
    const { data: pools } = await client.api.getPools()
    if (pools.length === 0) return ctx.skip()
    const seed = pools[0]!
    const t0 = seed.token0_info
    const t1 = seed.token1_info
    if (!t0?.wrapper_program || !t1?.wrapper_program) return ctx.skip() // metadata not indexed yet
    const token0 = seed.token0
    const token1 = seed.token1
    const token0Program = t0.wrapper_program
    const token1Program = t1.wrapper_program
    // seed.fee is a decimal string; work a different registered tier for a fresh pool.
    const fee = Number(seed.fee) === 3000 ? 500 : 3000

    // Skip unless the account actually holds both tokens (mint funds from records).
    const balances = await client.getPrivateBalances({ programs: [token0Program, token1Program] })
    if (!balances[token0Program] || !balances[token1Program]) return ctx.skip()

    // Token program sources for every write that dispatches into them.
    const imports = {
      [token0Program]: await getProgram(walletClient, { programId: token0Program }),
      [token1Program]: await getProgram(walletClient, { programId: token1Program }),
    }

    // ---- Create the pool only if it does not exist yet. derivePoolKey computes
    // the key locally (BHP256 struct hash, pair sorted like the contract), so
    // the existence check needs no round trip.
    const poolKey = await derivePoolKey({ token0, token1, fee })
    if (!(await client.getPool({ poolKey }))) {
      const created = await client.createPool({
        token0ProgramId: token0, // the token *field ids*, despite the name
        token1ProgramId: token1,
        fee,
        initialTick: 0,
      })
      expect(created.poolKey).toBe(poolKey) // local derivation matches the chain
    }

    // ---- Mint a position around the pool's current tick (the SDK rounds the
    // bounds to the tick spacing for you).
    const slot = await client.getSlot({ poolKey })
    const { positionTokenId } = await client.mint({
      poolKey,
      tickLower: slot!.tick - 10 * slot!.tick_spacing,
      tickUpper: slot!.tick + 10 * slot!.tick_spacing,
      amount0Desired: 1_000_000n,
      amount1Desired: 1_000_000n,
      token0Program,
      token1Program,
      imports,
    })
    expect(positionTokenId).toMatch(/field$/)

    // ---- Add to the position (same range, more funds).
    await client.increaseLiquidity({
      poolKey,
      amount0Desired: 1_000_000n,
      amount1Desired: 1_000_000n,
      token0Program,
      token1Program,
      imports,
    })

    // ---- Read the position's full liquidity straight from the on-chain
    // `positions` mapping — authoritative and already reflecting both the mint
    // and the increase (both confirmed above), unlike the lagging indexer.
    // A short poll rides out finalized-write read propagation.
    let liquidity = 0n
    for (let i = 0; i < 20; i++) {
      const raw = await publicClient
        .readContract({ programId: DEFAULT_PROGRAM, mapping: 'positions', key: positionTokenId! })
        .catch(() => undefined)
      const match = raw && String(raw).match(/liquidity:\s*(\d+)u128/)
      if (match) {
        liquidity = BigInt(match[1]!)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
    expect(liquidity).toBeGreaterThan(0n)

    // Remove all of it — the withdrawn amounts accrue to the position as owed
    // rather than transferring out (so decreaseLiquidity needs no imports).
    await client.decreaseLiquidity({ poolKey, liquidityToRemove: liquidity })

    // ---- Collect the owed tokens to private records (a large request sweeps
    // whatever is owed), then burn the now-empty position.
    await client.collect({
      poolKey,
      amount0Requested: 2n ** 64n,
      amount1Requested: 2n ** 64n,
      imports,
    })

    const burned = await client.burn({ poolKey })
    expect(burned.transactionId).toMatch(/^at1/)
    console.log(`position ${positionTokenId} minted, resized, collected, and burned`)
  }, 600_000)
})
