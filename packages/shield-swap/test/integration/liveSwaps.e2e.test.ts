import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { resolveDexImports } from '../../src/utils/imports.js'

/**
 * Swaps against the live testnet deployment: single hop, forced multi-hop, and
 * two concurrent swaps.
 *
 * Everything is discovered — pools from the API, balances from the chain and the
 * record scanner, token programs from the registry. Nothing is hardcoded, so the
 * suite follows the deployment rather than a snapshot of it.
 *
 * Spends real testnet balances. Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   funded testnet account
 *   ALEO_CONSUMER_ID, ALEO_DPS_API_KEY   Provable API credentials
 *
 *   VEIL_INTEGRATION=1 npx vitest run packages/shield-swap/test/integration/liveSwaps.e2e.test.ts
 */

const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const API_KEY = process.env.ALEO_DPS_API_KEY
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY && !!CONSUMER_ID && !!API_KEY
const TX = 600_000

type Token = { address: string; symbol: string; decimals: number; amm_token_program?: string | null }
type Pool = { key: string; token0: string; token1: string }

describe.runIf(RUN)('live swaps on testnet', () => {
  let client: ReturnType<ReturnType<typeof shieldSwapActions>> &
    Awaited<ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>>['walletClient']
  let tokens: Token[]
  let pools: Pool[]
  /** Private balance per token id — what a swap can actually spend. */
  let held: Map<string, bigint>

  const program = (id: string) => tokens.find((t) => t.address === id)!.amm_token_program!

  /** Waits for the swap's finalize write, which lands after the tx confirms. */
  const waitForOutput = async (swapId: string) => {
    for (let i = 0; i < 40; i++) {
      if ((await client.getSwapOutput({ swapId })) !== null) return true
      await new Promise((r) => setTimeout(r, 3_000))
    }
    return false
  }
  /** The pool for a pair, deepest first so swaps have price support. */
  const poolFor = (a: string, b: string) =>
    pools.find((p) => [p.token0, p.token1].includes(a) && [p.token0, p.token1].includes(b))

  beforeAll(async () => {
    const aleo = await loadNetwork('testnet')
    // No prover URL, no scanner URL, no DEX API URL: each defaults, and the
    // credentials build one Provable session shared by proving and scanning.
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: 'https://api.provable.com/v2',
      consumerId: CONSUMER_ID,
      apiKey: API_KEY,
      records: aleo.createRemoteScanner(),
      // Above the default: multi-hop swaps are the slow path here, one measured
      // at 322s. Not far above it — a write still absent after this is far more
      // likely dropped than pending, and waiting only delays finding out.
      confirmationTimeout: 400_000,
    })
    client = walletClient.extend(shieldSwapActions({ api: {} })) as typeof client
    await client.authenticateShieldSwap()

    tokens = (await client.api.getTokens()).data as Token[]
    pools = (await client.api.getPools({ limit: 50 })).data as Pool[]
    // Keyed by token id and already reconciled against the registry, unlike the
    // raw record sums which key by program or `program/token_id`.
    const balances = await client.getBalances()
    held = new Map(Object.entries(balances).map(([id, b]) => [id, b.private]))
  }, 180_000)

  it('discovers pools that are tradeable and funded', async () => {
    expect(pools.length).toBeGreaterThan(0)
    for (const p of pools) {
      // Both gates matter: the API can list a pool the chain refuses to trade.
      expect((await client.getTradeControls({ poolKey: p.key })).tradeable).toBe(true)
      expect((await client.getSlot({ poolKey: p.key }))!.liquidity).toBeGreaterThan(0n)
    }
    expect([...held.values()].some((v) => v > 0n)).toBe(true)
  }, 120_000)

  it('swaps a single hop and claims the output', async () => {
    const pool = pools.find((p) => held.get(p.token0)! > 0n || held.get(p.token1)! > 0n)!
    const tokenInId = held.get(pool.token0)! > 0n ? pool.token0 : pool.token1
    const amountIn = held.get(tokenInId)! / 1000n
    const imports = await resolveDexImports(client, {
      tokenPrograms: [program(pool.token0), program(pool.token1)],
    })

    const handle = await client.swap({ poolKey: pool.key, tokenInId, amountIn, slippageBps: 500, imports })
    // Always present on the local-signer path; optional only for wallet signers
    // that did not supply a blinded identity.
    const { swapId } = handle
    expect(swapId).toBeTruthy()

    // The chain, not the API, is the authority on what the swap produced.
    expect(await waitForOutput(swapId!)).toBe(true)
    const claim = await client.claimSwapOutput({ handle, imports })
    expect(claim.amountOut).toBeGreaterThan(0n)
  }, TX)

  it('swaps two hops through a bridging token and claims the output', async () => {
    // The live graph is complete across its three tokens, so the API's /route
    // never returns more than one hop. A two-hop path is therefore constructed:
    // sell a token we hold into a pair that shares a token with a second pool.
    const [from] = [...held].find(([, v]) => v > 0n)!
    const bridge = tokens.find(
      (t) => t.address !== from && poolFor(from, t.address) && pools.some((p) =>
        [p.token0, p.token1].includes(t.address) && ![p.token0, p.token1].includes(from)),
    )!
    const last = pools.find(
      (p) => [p.token0, p.token1].includes(bridge.address) && ![p.token0, p.token1].includes(from),
    )!
    const to = last.token0 === bridge.address ? last.token1 : last.token0
    const hops = [poolFor(from, bridge.address)!.key, last.key]

    const imports = await resolveDexImports(client, {
      tokenPrograms: [from, bridge.address, to].map(program),
    })
    const handle = await client.swapMultiHop({
      poolKeys: hops,
      tokenInId: from,
      amountIn: held.get(from)! / 1000n,
      slippageBps: 500,
      imports,
    })
    expect(handle.poolKeys).toEqual(hops)
    expect(await waitForOutput(handle.swapId!)).toBe(true)

    const claim = await client.claimSwapOutput({ handle, imports })
    expect(claim.amountOut).toBeGreaterThan(0n)
  }, TX)

  it('runs two swaps concurrently on pools that spend different tokens', async () => {
    // Concurrency contends on records: two swaps selecting the same record double
    // spend and one reverts. Disjoint input tokens keep the record sets apart.
    const funded = [...held].filter(([, v]) => v > 0n).map(([id]) => id)
    const pairs: { id: string; pool: Pool }[] = []
    for (const id of funded) {
      const pool = pools.find(
        (p) => [p.token0, p.token1].includes(id) && !pairs.some((q) => q.pool.key === p.key),
      )
      if (pool) pairs.push({ id, pool })
      if (pairs.length === 2) break
    }
    expect(pairs.length, 'need two funded tokens in two different pools').toBe(2)

    const results = await Promise.all(
      pairs.map(async ({ id, pool }) => {
        const imports = await resolveDexImports(client, {
          tokenPrograms: [program(pool.token0), program(pool.token1)],
        })
        const handle = await client.swap({
          poolKey: pool.key,
          tokenInId: id,
          amountIn: held.get(id)! / 1000n,
          slippageBps: 500,
          imports,
        })
        expect(await waitForOutput(handle.swapId!)).toBe(true)
        return client.claimSwapOutput({ handle, imports })
      }),
    )
    for (const r of results) expect(r.amountOut).toBeGreaterThan(0n)
  }, TX)
})
