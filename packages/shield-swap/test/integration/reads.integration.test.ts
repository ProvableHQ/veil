import { describe, it, expect } from 'vitest'
import { createPublicClient, http } from '@veil/core'
import { getPool } from '../../src/actions/reads/getPool.js'
import { getSlot } from '../../src/actions/reads/getSlot.js'
import { getSwapOutput } from '../../src/actions/reads/getSwapOutput.js'
import {
  isBlindedAddressUsed,
  isPoolInitialized,
  isFeeTierValid,
  isTickSpacingValid,
  getFeeToTickSpacing,
} from '../../src/actions/reads/validation.js'
import { PROGRAM_ID } from '../../src/generated/shield_swap.js'

// Real-API integration: hits the live testnet node and the live DEX API.
// Never mocked — these tests exist to catch drift between this client and the
// deployed contract/API. Gated so the default offline suite stays fast.
const RUN = process.env.VEIL_INTEGRATION === '1'

const API_BASE = 'https://api.provable.com/v2'
const NODE_URL = `${API_BASE}/testnet`
const INDEXER_URL = 'https://amm-api.dev.provable.com'

// The live DEX API currently serves pools created on shield_swap_v0_0_1; the
// v0_0_2 deployment starts with empty mappings. Reads try the target program
// first and fall back to the previous version so the decode path is always
// exercised against real chain data. Remove the fallback once v0_0_2 has pools.
const PREVIOUS_PROGRAM = 'shield_swap_v0_0_1.aleo'

describe.runIf(RUN)('reads against the real API', () => {
  const client = createPublicClient({ transport: http(API_BASE, { network: 'testnet' }) })

  it('getPool decodes a live pool discovered via the API', async () => {
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { data: { key: string }[] }
    expect(body.data.length).toBeGreaterThan(0)
    const poolKey = body.data[0]!.key

    let pool = await getPool(client, { poolKey })
    if (pool === null) {
      // v0_0_2 state not yet populated — decode the same layout from the
      // previous deployment to keep the real-data path covered.
      pool = await getPool(client, { poolKey, program: PREVIOUS_PROGRAM })
    }

    expect(pool).not.toBeNull()
    // Live values change; assert shape and width, not exact numbers.
    expect(typeof pool!.token0).toBe('string')
    expect(pool!.token0.endsWith('field')).toBe(true)
    expect(typeof pool!.token1).toBe('string')
    expect(typeof pool!.fee).toBe('number')
    expect(typeof pool!.enabled).toBe('boolean')
    expect(typeof pool!.scale0).toBe('bigint')
    expect(typeof pool!.scale1).toBe('bigint')
  }, 30_000)

  it('getPool returns null for a key that is not in the mapping', async () => {
    // A fixed 75-digit key — astronomically unlikely to collide with a real
    // BHP256-derived pool key, so this stays a missing-key probe forever.
    const absentKey = '111111111111111111111111111111111111111111111111111111111111111111111111111field'
    const pool = await getPool(client, { poolKey: absentKey })
    expect(pool).toBeNull()
  }, 30_000)

  it('getSlot decodes live trading state for an API-discovered pool', async () => {
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    const body = (await res.json()) as { data: { key: string }[] }
    const poolKey = body.data[0]!.key

    let slot = await getSlot(client, { poolKey })
    if (slot === null) {
      slot = await getSlot(client, { poolKey, program: PREVIOUS_PROGRAM })
    }

    expect(slot).not.toBeNull()
    expect(typeof slot!.tick).toBe('number')
    expect(typeof slot!.tick_spacing).toBe('number')
    expect(typeof slot!.sqrt_price).toBe('bigint')
    expect(slot!.sqrt_price > 0n).toBe(true)
    expect(typeof slot!.liquidity).toBe('bigint')
    expect(typeof slot!.next_init_below).toBe('number')
    expect(typeof slot!.next_init_above).toBe('number')
  }, 30_000)

  it('getSwapOutput returns null for an unknown swap id', async () => {
    const absent = '222222222222222222222222222222222222222222222222222222222222222222222222222field'
    expect(await getSwapOutput(client, { swapId: absent })).toBeNull()
  }, 30_000)

  it('validation reads agree with the API fee-tier registry', async () => {
    const res = await fetch(`${INDEXER_URL}/fee-tiers`)
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { data: { fee_tier: number }[] }
    expect(body.data.length).toBeGreaterThan(0)
    const fee = body.data[0]!.fee_tier

    // The target deployment must register the fee the API advertises,
    // bind a tick spacing to it, and register that spacing.
    expect(await isFeeTierValid(client, { fee })).toBe(true)
    const spacing = await getFeeToTickSpacing(client, { fee })
    expect(spacing).not.toBeNull()
    expect(await isTickSpacingValid(client, { tickSpacing: spacing! })).toBe(true)
    // An unregistered fee reads false, not an error.
    expect(await isFeeTierValid(client, { fee: 65535 })).toBe(false)
  }, 30_000)

  it('isPoolInitialized and isBlindedAddressUsed treat absence as false', async () => {
    const absentKey = '333333333333333333333333333333333333333333333333333333333333333333333333333field'
    expect(await isPoolInitialized(client, { poolKey: absentKey })).toBe(false)
    // A fresh, never-used address (the zero-value address literal).
    const fresh = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
    expect(await isBlindedAddressUsed(client, { address: fresh })).toBe(false)
  }, 30_000)

  it('tick math brackets a live pool sqrt_price (table agrees with chain)', async () => {
    const { getSqrtPriceAtTick } = await import('../../src/utils/tick-math.js')
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    const body = (await res.json()) as { data: { key: string }[] }
    const poolKey = body.data[0]!.key
    let slot = await getSlot(client, { poolKey })
    if (slot === null) slot = await getSlot(client, { poolKey, program: PREVIOUS_PROGRAM })
    expect(slot).not.toBeNull()
    // The live sqrt_price must sit inside its active tick's bracket — a
    // one-off magic constant in our port would break this immediately.
    expect(slot!.sqrt_price >= getSqrtPriceAtTick(slot!.tick)).toBe(true)
    expect(slot!.sqrt_price < getSqrtPriceAtTick(slot!.tick + 1)).toBe(true)
  }, 30_000)

  it('a freshly derived blinded identity is unused on chain', async () => {
    // Devnode test account (public key) — same fixtures as the golden vectors.
    const { nextBlindedIdentity } = await import('../../src/utils/blinding/identity.js')
    const id = await nextBlindedIdentity(client, {
      viewKeyScalar: '334926304971763782347498121479281870911723639068413954564748091722770623877scalar',
      signer: 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px',
    })
    // The scan itself asserted the address is unused; sanity-check the shape.
    expect(id.counter).toBeGreaterThanOrEqual(0)
    expect(id.blindingFactor.endsWith('field')).toBe(true)
    expect(id.blindedAddress.startsWith('aleo1')).toBe(true)
    expect(await isBlindedAddressUsed(client, { address: id.blindedAddress })).toBe(false)
  }, 60_000)

  it(`target program ${PROGRAM_ID} is deployed with the expected mappings`, async () => {
    const res = await fetch(`${NODE_URL}/program/${PROGRAM_ID}/mappings`)
    expect(res.ok).toBe(true)
    const mappings = (await res.json()) as string[]
    for (const m of ['pools', 'slots', 'swap_outputs', 'used_blinded_addresses']) {
      expect(mappings).toContain(m)
    }
  }, 30_000)
})
