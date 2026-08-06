/**
 * Reading a pool: what the API says, and what the chain says.
 *
 * Two sources answer questions about a pool, and they are not interchangeable.
 * The DEX API knows the pool graph and is the only practical way to discover
 * what exists — the chain has no index to list pools from. The chain is what the
 * contract actually enforces at finalize.
 *
 * The rule that follows: discovery comes from the API, and anything that gates
 * money movement comes from a chain read. A pool the index lists can be paused
 * on chain, and a swap into it reverts.
 *
 * Needs nothing — no key, no proving, no scanner.
 */
import { readClient } from './setup-client.js'

export async function poolState() {
  const client = readClient()

  // Pool and token discovery are the two DEX endpoints served without a bearer
  // token. Everything else needs an authenticated session.
  const { data: pools } = await client.api.getPools({ limit: 5 })

  // Every pool is independent, and so are the two reads per pool, so they all go
  // out at once. Awaiting each in turn would serialize round trips that have no
  // reason to wait for each other — the shape worth copying, not a `for` loop.
  const rows = await Promise.all(
    pools.map(async (pool) => {
      const [slot, controls] = await Promise.all([
        // `getSlot` reads the pool's live state straight from the contract's
        // mappings: the current tick, and the liquidity active at it. A pool key
        // the API lists but the chain has never initialized returns null.
        client.getSlot({ poolKey: pool.key }),
        // Trading can be switched off globally, per pair, or per token.
        // `tradeable` collapses all three into the one answer a caller acts on.
        // This is the read to make before sizing a trade — not the API's view.
        client.getTradeControls({ poolKey: pool.key }),
      ])
      return { pool, slot, controls }
    }),
  )

  for (const { pool, slot, controls } of rows) {
    if (!slot) continue
    console.log(
      `${pool.token0_info?.symbol}/${pool.token1_info?.symbol}`,
      // The tick is a log-scale price index: price = 1.0001 ^ tick, adjusted for
      // the two tokens' decimals.
      `tick ${slot.tick}`,
      // Liquidity active at the current tick, not the pool's total deposits.
      // Liquidity parked in ranges the price has moved away from is not counted.
      `liquidity ${slot.liquidity}`,
      controls.tradeable ? 'tradeable' : 'NOT tradeable',
    )
  }
}
