import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { getPosition } from '../../src/actions/reads/getPosition.js'

/**
 * Real-chain e2e for the owned-position views: scans the keyed account's
 * PositionNFT records and cross-checks every joined view against the public
 * `positions` mapping. Read-only — no transactions, and never mints. The
 * account behind VEIL_E2E_PRIVATE_KEY is expected to hold at least one live
 * position.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   the account whose positions are read
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID   register the record scanner
 */
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const DPS_API_KEY = process.env.ALEO_DPS_API_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY && !!DPS_API_KEY && !!CONSUMER_ID

const NETWORK_URL = 'https://api.provable.com/v2'
const RSS_URL = process.env.ALEO_RSS_URL ?? 'https://api.provable.com/scanner'
const DEX_PROGRAM = process.env.VEIL_DEX_PROGRAM ?? 'shield_swap.aleo'

describe.runIf(RUN)('owned positions against the real chain + scanner', () => {
  let client: ReturnType<ReturnType<typeof shieldSwapActions>>
  // Fetched once by the first test; the single-position test reuses it to
  // avoid a second multi-second record scan.
  let positions: Awaited<ReturnType<typeof client.getOwnedPositions>>

  beforeAll(async () => {
    const aleo = await loadNetwork('testnet')
    const scanner = aleo.createRemoteScanner({ url: RSS_URL, consumerId: CONSUMER_ID!, apiKey: DPS_API_KEY })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      apiKey: DPS_API_KEY,
      consumerId: CONSUMER_ID,
      records: scanner,
    })
    client = walletClient.extend(shieldSwapActions({ program: DEX_PROGRAM }))
  }, 60_000)

  it('lists at least one position with a coherent joined view', async () => {
    positions = await client.getOwnedPositions()
    expect(positions.length).toBeGreaterThanOrEqual(1)

    for (const p of positions) {
      expect(p.positionTokenId).toMatch(/field$/)
      expect(p.poolKey).toMatch(/field$/)
      expect(p.tickLower).toBeLessThan(p.tickUpper)
      expect(p.withdrawal).toMatch(/^aleo1/)
      expect(p.record.recordPlaintext).toBeTruthy()

      // Live positions should be finalized; cross-check against the mapping.
      expect(p.state).not.toBeNull()
      const mapped = await getPosition(client, { positionTokenId: p.positionTokenId, program: DEX_PROGRAM })
      expect(mapped).not.toBeNull()
      expect(p.state!.liquidity).toBe(mapped!.liquidity)
      expect(p.state!.tokensOwed0).toBe(mapped!.tokens_owed0)
      expect(p.state!.tokensOwed1).toBe(mapped!.tokens_owed1)
      expect(mapped!.pool).toBe(p.poolKey)
      expect(mapped!.tick_lower).toBe(p.tickLower)
      expect(mapped!.tick_upper).toBe(p.tickUpper)

      // Derived values: fees include the settled owed side; zero liquidity
      // means zero backing amounts.
      expect(p.state!.uncollectedFees0 >= p.state!.tokensOwed0).toBe(true)
      expect(p.state!.uncollectedFees1 >= p.state!.tokensOwed1).toBe(true)
      if (p.state!.liquidity === 0n) {
        expect(p.state!.amount0).toBe(0n)
        expect(p.state!.amount1).toBe(0n)
      }
    }
  }, 180_000)

  it('resolves a single position by id and misses cleanly on a bogus id', async () => {
    const [first] = positions
    const single = await client.getOwnedPosition({ positionTokenId: first!.positionTokenId })
    expect(single).not.toBeNull()
    expect(single!.positionTokenId).toBe(first!.positionTokenId)
    expect(single!.state?.liquidity).toBe(first!.state?.liquidity)

    expect(await client.getOwnedPosition({ positionTokenId: '1field' })).toBeNull()
  }, 120_000)
})
